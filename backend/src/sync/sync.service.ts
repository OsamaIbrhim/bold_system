import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService, private pricing: PricingService) {}

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
    if (!changes.length) {
      return {
        mode: 'delta',
        cursor,
        server_time: new Date().toISOString(),
        products: [],
        stock: [],
        deleted_variant_ids: [],
        reset_products: false,
        reset_stock: false,
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
    const deletedVariantIds = resetCatalog
      ? []
      : [...requestedIds].filter((id) => !presentIds.has(id));
    const quotes = this.pricing.quoteMany(variants, rules);
    const products = variants.map((variant) => this.productSnapshot(variant, quotes.get(variant.id)!));

    return {
      mode: 'delta',
      cursor: changes[changes.length - 1].sequence.toString(),
      server_time: new Date().toISOString(),
      products,
      stock,
      deleted_variant_ids: deletedVariantIds,
      reset_products: resetCatalog,
      reset_stock: resetCatalog,
      has_more: changes.length === 5_000,
    };
  }

  private async snapshot(branchId: string) {
    // Capture the cursor before reading the snapshot. A change committed after
    // this point will be returned by the next delta even if it races the read.
    const cursor = await this.prisma.syncChange.aggregate({ _max: { sequence: true } });
    const [variants, stock, rules] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { product: { is_active: true } },
        include: { product: true },
      }),
      this.prisma.inventoryStock.findMany({ where: { branch_id: branchId } }),
      this.pricing.loadActiveRules(),
    ]);
    const quotes = this.pricing.quoteMany(variants, rules);
    const products = variants.map((variant) => this.productSnapshot(variant, quotes.get(variant.id)!));
    return {
      mode: 'snapshot',
      cursor: (cursor._max.sequence || 0n).toString(),
      server_time: new Date().toISOString(),
      products,
      stock,
      deleted_variant_ids: [],
      reset_products: true,
      reset_stock: true,
    };
  }

  private productSnapshot(variant: any, quote: ReturnType<PricingService['quote']>) {
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
    };
  }
}
