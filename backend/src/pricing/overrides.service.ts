import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import { OverridesRepository } from './overrides.repository';
import { PricingService } from './pricing.service';
import { CostVisibilityService } from './cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { decimal, money } from '../common/money';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ApplyOverrideDto, PriceOverridePolicyDto } from './dto/override.dto';
import { ApplyDiscountDto } from './dto/discount.dto';

/**
 * WP-008 Phase B (BR-OVP-1xx, BR-DSC-2xx, Permission Matrix §17).
 *
 * Manual override and discount are kept as distinct entities (BR-OVP-100):
 * an override changes the applied unit price directly (within a
 * role-configured limit, `pricing.manual-override.apply`), a discount is a
 * separate calculated adjustment on top of the resolved price. Neither ever
 * mutates the Price Book (BR-OVP-103/BR-DSC-205) — both are audit rows
 * against the price the evaluation engine resolved at the moment they were
 * applied.
 */
@Injectable()
export class OverridesService {
  constructor(
    private readonly repository: OverridesRepository,
    private readonly pricing: PricingService,
    private readonly permissionPolicy: PermissionPolicyService,
    private readonly costVisibility: CostVisibilityService,
  ) {}

  savePolicy(context: TenantContext, role: MembershipRole, dto: PriceOverridePolicyDto) {
    return this.repository.savePolicy(context, role, {
      maxDiscountPercent: dto.max_discount_percent ?? null,
      maxDiscountAmount: dto.max_discount_amount ?? null,
      allowPriceIncrease: dto.allow_price_increase ?? true,
    });
  }

  /** Rows carry the resolved (often cost-derived) floor — masked per BR-CST-101. */
  async listOverrides(context: TenantContext, actor: AuthenticatedUser, variantId?: string) {
    return this.costVisibility.maskFloors(actor, await this.repository.listOverrides(context, variantId));
  }

  listDiscounts(context: TenantContext, variantId?: string) {
    return this.repository.listDiscounts(context, variantId);
  }

  /**
   * BR-OVP-101/102: validates the override against the calling role's
   * configured limit and the resolved floor before recording it. Below-floor
   * requires `pricing.manual-override.above-threshold` — holding
   * `pricing.manual-override.apply` alone never implies it (WP-008 Phase B
   * §B.4.5).
   */
  async applyOverride(context: TenantContext, actor: AuthenticatedUser, dto: ApplyOverrideDto) {
    const quote = await this.pricing.calculate(context, dto.variant_id, undefined, dto.qty ?? 1);
    const basePrice = decimal(quote.net_price);
    const floor = decimal(quote.min_allowed_price);
    const overridePrice = decimal(dto.override_price);

    if (overridePrice.lt(0)) {
      throw new AthrDomainError(
        'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED',
        'override_price must not be negative.',
      );
    }

    const role = actor.membership_role ?? null;
    const policy = role ? await this.repository.findPolicy(context, role) : null;

    if (overridePrice.gt(basePrice)) {
      if (policy && policy.allow_price_increase === false) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_LIMIT_EXCEEDED',
          'This role is not permitted to increase the price via a manual override.',
        );
      }
    } else if (overridePrice.lt(basePrice)) {
      const discountAmount = basePrice.minus(overridePrice);
      const discountPercent = basePrice.gt(0) ? discountAmount.div(basePrice).mul(100) : decimal(0);
      if (policy?.max_discount_percent != null && discountPercent.gt(policy.max_discount_percent)) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_LIMIT_EXCEEDED',
          `Override discount ${discountPercent.toFixed(2)}% exceeds this role's configured limit of ${policy.max_discount_percent}%.`,
        );
      }
      if (policy?.max_discount_amount != null && discountAmount.gt(policy.max_discount_amount)) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_LIMIT_EXCEEDED',
          `Override discount ${discountAmount.toFixed(2)} exceeds this role's configured limit of ${policy.max_discount_amount}.`,
        );
      }
    }

    const isBelowFloor = overridePrice.lt(floor);
    if (isBelowFloor) {
      // BR-OVP-102: a distinct, explicitly-grantable permission — never
      // implied by `pricing.manual-override.apply`. It authorizes *requesting*
      // a below-floor override; the approval itself is a second, separate act
      // by a different identity (see `approveOverride`).
      const canRequestBelowFloor = role
        ? await this.permissionPolicy.hasPermission(role, 'pricing.manual-override.above-threshold')
        : false;
      if (!canRequestBelowFloor) {
        // BR-CST-101/Matrix §51: the floor is the variant's cost whenever the
        // resolved entry has no explicit floor, so the *rejection* must not
        // quote it either — a refused request disclosing cost verbatim is the
        // same leak as an accepted one.
        throw new AthrDomainError(
          'PRICING_OVERRIDE_BELOW_FLOOR_REQUIRES_APPROVAL',
          await this.belowFloorMessage(actor, overridePrice, floor),
        );
      }
    }

    const created = await this.repository.createOverride(context, {
      variantId: dto.variant_id,
      reference: dto.reference ?? null,
      basePrice: money(basePrice),
      overridePrice: money(overridePrice),
      floorPrice: money(floor),
      isBelowFloor,
      reason: dto.reason,
      appliedBy: actor.sub,
      // Matrix §17/§63: a below-floor override is recorded PENDING. The actor
      // applying it can never be its own approver, so it is not self-approved
      // here — `POST /pricing/overrides/:id/approve` records an independent
      // approver (`pricing.manual-override.approve`).
      approvedBy: null,
      approvedAt: null,
    });
    return this.costVisibility.maskFloor(actor, created);
  }

  /**
   * BR-OVP-102 + Permission Matrix §17/§63/§64: records the independent
   * approval of a pending below-floor override. The approver must be a
   * different *identity* from the applier — §64 is explicit that a second
   * session of the same identity does not satisfy separation, which is why
   * the applier is compared by `sub` and never taken from the request body
   * (CLAUDE.md §1: authorization context comes from token claims, never from
   * client-supplied fields).
   */
  async approveOverride(context: TenantContext, actor: AuthenticatedUser, id: string) {
    const override = await this.repository.findOverrideById(context, id);
    if (!override) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Price override ${id} not found.`);
    }
    if (!override.is_below_floor || override.approved_by) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_NOT_PENDING_APPROVAL',
        `Price override ${id} is not awaiting a below-floor approval.`,
      );
    }
    if (override.applied_by === actor.sub) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_SELF_APPROVAL_FORBIDDEN',
        `Price override ${id} was applied by this same actor; an independent approver is required.`,
      );
    }

    const { applied } = await this.repository.recordOverrideApproval(context, id, actor.sub);
    if (!applied) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_NOT_PENDING_APPROVAL',
        `Price override ${id} could not be approved — it was changed concurrently.`,
      );
    }
    const approved = await this.repository.findOverrideById(context, id);
    return this.costVisibility.maskFloor(actor, approved!);
  }

  private async belowFloorMessage(
    actor: AuthenticatedUser,
    overridePrice: ReturnType<typeof decimal>,
    floor: ReturnType<typeof decimal>,
  ): Promise<string> {
    const suffix = 'this requires "pricing.manual-override.above-threshold" and an independent approval.';
    if (await this.costVisibility.canViewCostDerivedValues(actor)) {
      return `Override price ${overridePrice.toFixed(2)} is below the floor (${floor.toFixed(2)}); ${suffix}`;
    }
    return `Override price ${overridePrice.toFixed(2)} is below the configured floor for this item; ${suffix}`;
  }

  /** BR-DSC-200/202/203: a calculated adjustment, distinct from an override; never negative. */
  async applyDiscount(context: TenantContext, actor: AuthenticatedUser, dto: ApplyDiscountDto) {
    const quote = await this.pricing.calculate(context, dto.variant_id, undefined, dto.qty ?? 1);
    const basePrice = decimal(quote.net_price);

    let finalPrice: ReturnType<typeof decimal>;
    if (dto.basis === 'percentage') {
      if (dto.amount > 100) {
        throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'A percentage discount amount must be between 0 and 100.');
      }
      finalPrice = basePrice.mul(decimal(100).minus(dto.amount)).div(100);
    } else {
      finalPrice = basePrice.minus(dto.amount);
    }
    finalPrice = money(finalPrice);
    if (finalPrice.lt(0)) {
      throw new AthrDomainError(
        'PRICING_DISCOUNT_EXCEEDS_BASE_PRICE',
        `A discount of ${dto.amount} (${dto.basis}) would take the price below zero (base ${basePrice.toFixed(2)}).`,
      );
    }

    // BR-DSC-203: manual discounts share the same role-configured limits as overrides.
    const role = actor.membership_role ?? null;
    const policy = role ? await this.repository.findPolicy(context, role) : null;
    const discountAmount = basePrice.minus(finalPrice);
    const discountPercent = basePrice.gt(0) ? discountAmount.div(basePrice).mul(100) : decimal(0);
    if (policy?.max_discount_percent != null && discountPercent.gt(policy.max_discount_percent)) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_LIMIT_EXCEEDED',
        `Discount ${discountPercent.toFixed(2)}% exceeds this role's configured limit of ${policy.max_discount_percent}%.`,
      );
    }
    if (policy?.max_discount_amount != null && discountAmount.gt(policy.max_discount_amount)) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_LIMIT_EXCEEDED',
        `Discount ${discountAmount.toFixed(2)} exceeds this role's configured limit of ${policy.max_discount_amount}.`,
      );
    }

    return this.repository.createDiscount(context, {
      variantId: dto.variant_id,
      reference: dto.reference ?? null,
      source: 'manual',
      basis: dto.basis,
      amount: dto.amount,
      basePrice: money(basePrice),
      finalPrice,
      reason: dto.reason ?? null,
      appliedBy: actor.sub,
    });
  }
}
