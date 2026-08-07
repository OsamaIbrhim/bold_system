import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
  ) {}

  private catalogValidUntil(now = Date.now()) {
    const configured = Number(process.env.POS_PRICE_CATALOG_TTL_MS || 86_400_000);
    const ttl = Number.isFinite(configured) && configured >= 60_000 ? configured : 86_400_000;
    return new Date(now + ttl).toISOString();
  }

  async pull(context: TenantContext, branchId: string, cursor?: string) {
    if (!cursor) return this.snapshot(context, branchId);
    let parsedCursor: bigint;
    try {
      parsedCursor = BigInt(cursor);
      if (parsedCursor < 0n) throw new Error('negative');
    } catch {
      throw new BadRequestException('cursor must be a non-negative integer');
    }

    const changes = await this.prisma.syncChange.findMany({
      where: {
        tenant_id: context.tenantId,
        sequence: { gt: parsedCursor },
        OR: [{ branch_id: null }, { branch_id: branchId }],
      },
      orderBy: { sequence: 'asc' },
      take: 5_000,
    });
    const issuedAt = new Date().toISOString();
    const catalogValidUntil = this.catalogValidUntil();
    const sellers = await this.sellers(context, branchId);
    if (!changes.length) {
      return {
        mode: 'delta', cursor, server_time: issuedAt,
        catalog_valid_until: catalogValidUntil,
        products: [], stock: [], deleted_variant_ids: [],
        sellers, reset_sellers: true,
        reset_products: false, reset_stock: false, has_more: false,
      };
    }

    const resetCatalog = changes.some((change) => change.kind === 'product' || change.kind === 'pricing');
    const requestedIds = new Set(
      changes
        .filter((change) => change.kind === 'variant' || change.kind === 'inventory')
        .map((change) => change.entity_key)
        .filter((value): value is string => !!value),
    );
    const [variants, stock, rules] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: {
          tenant_id: context.tenantId,
          product: { is_active: true, tenant_id: context.tenantId },
          is_active: true,
          ...(resetCatalog ? {} : { id: { in: [...requestedIds] } }),
        },
        include: { product: true },
      }),
      this.prisma.inventoryStock.findMany({
        where: {
          tenant_id: context.tenantId,
          branch_id: branchId,
          ...(resetCatalog ? {} : { variant_id: { in: [...requestedIds] } }),
        },
      }),
      this.pricing.loadActiveRules(context),
    ]);
    const presentIds = new Set(variants.map((variant) => variant.id));
    const deletedVariantIds = resetCatalog ? [] : [...requestedIds].filter((id) => !presentIds.has(id));
    const quotes = this.pricing.quoteMany(variants, rules);
    // WP-008 Phase B (BR-PSL-101): a variant with no resolvable price is
    // omitted from `quotes` rather than throwing (unlike `calculate`) --
    // the offline catalog snapshot must not fail entirely for one unpriced
    // item. It is simply not advertised to POS until it is priced.
    const products = variants
      .filter((variant) => quotes.has(variant.id))
      .map((variant) => this.productSnapshot(variant, quotes.get(variant.id)!, issuedAt));

    return {
      mode: 'delta',
      cursor: changes[changes.length - 1].sequence.toString(),
      server_time: issuedAt,
      catalog_valid_until: catalogValidUntil,
      products, stock, deleted_variant_ids: deletedVariantIds,
      reset_products: resetCatalog, reset_stock: resetCatalog,
      sellers, reset_sellers: true,
      has_more: changes.length === 5_000,
    };
  }

  private async snapshot(context: TenantContext, branchId: string) {
    const cursor = await this.prisma.syncChange.aggregate({
      where: { tenant_id: context.tenantId },
      _max: { sequence: true },
    });
    const [variants, stock, rules, sellers] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: {
          tenant_id: context.tenantId,
          is_active: true,
          product: { is_active: true, tenant_id: context.tenantId },
        },
        include: { product: true },
      }),
      this.prisma.inventoryStock.findMany({
        where: { tenant_id: context.tenantId, branch_id: branchId },
      }),
      this.pricing.loadActiveRules(context),
      this.sellers(context, branchId),
    ]);
    const issuedAt = new Date().toISOString();
    const quotes = this.pricing.quoteMany(variants, rules);
    const products = variants
      .filter((variant) => quotes.has(variant.id))
      .map((variant) => this.productSnapshot(variant, quotes.get(variant.id)!, issuedAt));
    return {
      mode: 'snapshot',
      cursor: (cursor._max.sequence || 0n).toString(),
      server_time: issuedAt,
      catalog_valid_until: this.catalogValidUntil(),
      products, stock, deleted_variant_ids: [],
      sellers, reset_sellers: true,
      reset_products: true, reset_stock: true, has_more: false,
    };
  }

  private sellers(context: TenantContext, branchId: string) {
    const users = (this.prisma as any).user;
    if (!users) return Promise.resolve([]);
    return users.findMany({
      where: {
        // User has no tenant_id column (ADR-0003); scope through Membership.
        memberships: { some: { tenantId: context.tenantId } },
        branch_id: branchId,
        role: 'seller',
        is_active: true,
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  private productSnapshot(
    variant: any,
    quote: ReturnType<PricingService['quote']>,
    issuedAt: string,
  ) {
    return {
      catalog_version: 2,
      id: variant.id,
      sku: variant.sku,
      name_en: variant.product.name_en,
      name_ar: variant.product.name_ar,
      barcode_ean13: variant.barcode_ean13,
      barcode_internal: variant.barcode_internal,
      size: variant.size,
      color: variant.color,
      selling_price: quote.net_price,
      unit_tax: quote.tax_amount,
      price_issued_at: issuedAt,
    };
  }
}
