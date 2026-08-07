import { Injectable } from '@nestjs/common';
import type { Discount, DiscountBasis, MembershipRole, PriceOverride, PriceOverridePolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantScope } from '../identity/tenant-context.type';

/**
 * WP-008 Phase B — tenant-scoped repository for `PriceOverride`/`Discount`/
 * `PriceOverridePolicy` (BR-OVP-1xx, BR-DSC-2xx). `PriceOverride` and
 * `Discount` are append-only evidence records (BR-PSL-105) — there is
 * deliberately no update/delete here.
 */
@Injectable()
export class OverridesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPolicy(context: TenantScope, role: MembershipRole): Promise<PriceOverridePolicy | null> {
    return this.prisma.priceOverridePolicy.findFirst({ where: { tenant_id: context.tenantId, role } });
  }

  async savePolicy(
    context: TenantScope,
    role: MembershipRole,
    data: {
      maxDiscountPercent: Prisma.Decimal.Value | null;
      maxDiscountAmount: Prisma.Decimal.Value | null;
      allowPriceIncrease: boolean;
    },
  ): Promise<PriceOverridePolicy> {
    const existing = await this.findPolicy(context, role);
    const fields = {
      max_discount_percent: data.maxDiscountPercent,
      max_discount_amount: data.maxDiscountAmount,
      allow_price_increase: data.allowPriceIncrease,
    };
    if (existing) {
      return this.prisma.priceOverridePolicy.update({ where: { id: existing.id }, data: fields });
    }
    return this.prisma.priceOverridePolicy.create({
      data: { tenant_id: context.tenantId, role, ...fields },
    });
  }

  async createOverride(
    context: TenantScope,
    data: {
      variantId: string;
      reference: string | null;
      basePrice: Prisma.Decimal.Value;
      overridePrice: Prisma.Decimal.Value;
      floorPrice: Prisma.Decimal.Value | null;
      isBelowFloor: boolean;
      reason: string;
      appliedBy: string;
      approvedBy: string | null;
      approvedAt: Date | null;
    },
  ): Promise<PriceOverride> {
    return this.prisma.priceOverride.create({
      data: {
        tenant_id: context.tenantId,
        variant_id: data.variantId,
        reference: data.reference,
        base_price: data.basePrice,
        override_price: data.overridePrice,
        floor_price: data.floorPrice,
        is_below_floor: data.isBelowFloor,
        reason: data.reason,
        applied_by: data.appliedBy,
        approved_by: data.approvedBy,
        approved_at: data.approvedAt,
      },
    });
  }

  async findOverrideById(context: TenantScope, id: string): Promise<PriceOverride | null> {
    return this.prisma.priceOverride.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  /**
   * BR-OVP-102 + Matrix §17: records the independent approval on a pending
   * below-floor override. `approved_by IS NULL` is part of the predicate, so
   * two approvers racing can never overwrite each other's recorded identity —
   * exactly one write wins and the loser sees `count === 0` (same pattern as
   * `PriceBookRepository.transition`). This is the one mutation on an
   * otherwise append-only evidence table: it fills the approval fields and
   * touches nothing else.
   */
  async recordOverrideApproval(
    context: TenantScope,
    id: string,
    approverId: string,
  ): Promise<{ applied: boolean }> {
    const changed = await this.prisma.priceOverride.updateMany({
      where: {
        id,
        tenant_id: context.tenantId,
        is_below_floor: true,
        approved_by: null,
        applied_by: { not: approverId },
      },
      data: { approved_by: approverId, approved_at: new Date() },
    });
    return { applied: changed.count === 1 };
  }

  async listOverrides(context: TenantScope, variantId?: string): Promise<PriceOverride[]> {
    return this.prisma.priceOverride.findMany({
      where: { tenant_id: context.tenantId, ...(variantId ? { variant_id: variantId } : {}) },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    });
  }

  async createDiscount(
    context: TenantScope,
    data: {
      variantId: string;
      reference: string | null;
      source: string;
      basis: DiscountBasis;
      amount: Prisma.Decimal.Value;
      basePrice: Prisma.Decimal.Value;
      finalPrice: Prisma.Decimal.Value;
      reason: string | null;
      appliedBy: string;
    },
  ): Promise<Discount> {
    return this.prisma.discount.create({
      data: {
        tenant_id: context.tenantId,
        variant_id: data.variantId,
        reference: data.reference,
        source: data.source,
        basis: data.basis,
        amount: data.amount,
        base_price: data.basePrice,
        final_price: data.finalPrice,
        reason: data.reason,
        applied_by: data.appliedBy,
      },
    });
  }

  async listDiscounts(context: TenantScope, variantId?: string): Promise<Discount[]> {
    return this.prisma.discount.findMany({
      where: { tenant_id: context.tenantId, ...(variantId ? { variant_id: variantId } : {}) },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    });
  }
}
