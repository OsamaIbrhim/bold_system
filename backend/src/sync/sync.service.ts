import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { PriceSnapshotService } from '../pricing/price-snapshot.service';

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private priceSnapshots: PriceSnapshotService,
  ) {}

  private catalogValidUntil(now = Date.now()) {
    const configured = Number(process.env.POS_PRICE_CATALOG_TTL_MS || 86_400_000);
    const ttl = Number.isFinite(configured) && configured >= 60_000 ? configured : 86_400_000;
    return new Date(now + ttl).toISOString();
  }

  async pull(branchId: string, cursor?: string) {
    if (!cursor) return this.snapshot(branchId);
    let parsedCursor: bigint;
    try {
      parsedCursor = BigInt(cursor);
      if (parsedCursor < 0n) throw new Error('negative');
    } catch {
      throw new BadRequestException('cursor must be a non-negative integer');
    }

    const changes = await this.prisma.syncChange.findMany({
      where: {
        sequence: { gt: parsedCursor },
        OR: [{ branch_id: null }, { branch_id: branchId }],
      },
      orderBy: { sequence: 'asc' },
      take: 5_000,
    });
    const issuedAt = new Date().toISOString();
    const catalogValidUntil = this.catalogValidUntil();
    const sellers = await this.sellers(branchId);
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
          product: { is_active: true },
          ...(resetCatalog ? {} : { id: { in: [...requestedIds] } }),
        },
        include: { product: true },
      }),
      this.prisma.inventoryStock.findMany({
        where: {
          branch_id: branchId,
          ...(resetCatalog ? {} : { variant_id: { in: [...requestedIds] } }),
        },
      }),
      this.pricing.loadActiveRules(),
    ]);
    const presentIds = new Set(variants.map((variant) => variant.id));
    const deletedVariantIds = resetCatalog ? [] : [...requestedIds].filter((id) => !presentIds.has(id));
    const quotes = this.pricing.quoteMany(variants, rules);
    const products = variants.map((variant) =>
      this.productSnapshot(branchId, variant, quotes.get(variant.id)!, issuedAt),
    );

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

  private async snapshot(branchId: string) {
    const cursor = await this.prisma.syncChange.aggregate({ _max: { sequence: true } });
    const [variants, stock, rules, sellers] = await Promise.all([
      this.prisma.productVariant.findMany({ where: { product: { is_active: true } }, include: { product: true } }),
      this.prisma.inventoryStock.findMany({ where: { branch_id: branchId } }),
      this.pricing.loadActiveRules(),
      this.sellers(branchId),
    ]);
    const issuedAt = new Date().toISOString();
    const quotes = this.pricing.quoteMany(variants, rules);
    const products = variants.map((variant) =>
      this.productSnapshot(branchId, variant, quotes.get(variant.id)!, issuedAt),
    );
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

  private sellers(branchId: string) {
    const users = (this.prisma as any).user;
    if (!users) return Promise.resolve([]);
    return users.findMany({
      where: {
        branch_id: branchId,
        role: 'seller',
        is_active: true,
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  private productSnapshot(branchId: string, variant: any, quote: ReturnType<PricingService['quote']>, issuedAt: string) {
    const signed = this.priceSnapshots.issue(branchId, variant.id, quote, issuedAt);
    return {
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
      price_version: signed.price_version,
      price_token: signed.price_token,
      price_issued_at: signed.issued_at,
    };
  }
}
