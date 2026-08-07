import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, PriceEntryScopeType } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { decimal, money } from '../common/money';
import type { TenantScope } from '../identity/tenant-context.type';

export type PriceableVariant = {
  id: string;
  product_id: string;
  cost_price: Prisma.Decimal | number | string;
  product: { category_id?: string | null; brand_id?: string | null };
};

/** One line to price: a variant at a specific quantity (BR-PSL-104 quantity breaks). */
export interface PriceableLine {
  variant: PriceableVariant;
  qty: number;
}

/** The pre-loaded, tenant-scoped, already-effective set of entries `quote()`/`quoteMany()` resolve against. */
export type ResolvedPriceEntry = {
  id: string;
  price_book_id: string;
  scope_type: PriceEntryScopeType;
  scope_id: string | null;
  min_qty: Prisma.Decimal | number | string;
  unit_price: Prisma.Decimal | number | string;
  allow_zero_price: boolean;
  tax_percent: Prisma.Decimal | number | string;
  floor_price: Prisma.Decimal | number | string | null;
};

/**
 * Pre-bucketed entries, keyed by `"<scope_type>:<scope_id>"`. Built once per
 * call so resolution is O(1) per variant per scope level instead of a linear
 * scan of every entry in the tenant (the POS snapshot path prices the whole
 * catalog in one go — at N entries and N variants the scan was O(N²)).
 */
export type PriceEntryIndex = ReadonlyMap<string, readonly ResolvedPriceEntry[]>;

export type PriceQuote = {
  qty: number;
  unit_price: number;
  /** Kept alongside `unit_price` for callers written against the pre-Phase-B shape (offers/sales/sync). */
  net_price: number;
  tax_percent: number;
  tax_amount: number;
  selling_price: number;
  /**
   * BR-OVP-102 floor: the entry's explicit `floor_price`, or the variant's
   * cost as a cost-based fallback. **Cost-sensitive** (BR-CST-101, Permission
   * Matrix §51) — HTTP boundaries must strip this for a caller without
   * `pricing.cost.view`/`pricing.margin.view`; see `CostVisibilityService`.
   */
  min_allowed_price: number;
  /**
   * True when `min_allowed_price` came from the variant's `cost_price` rather
   * than an explicit `floor_price` on the entry. Post-migration every entry
   * has a null `floor_price`, so today this is true for essentially the whole
   * catalog — which is exactly why the masking is unconditional at the
   * boundary rather than conditional on this flag.
   */
  floor_is_cost_derived: boolean;
  source: {
    price_book_id: string;
    entry_id: string;
    scope_type: PriceEntryScopeType;
    scope_id: string | null;
    min_qty: number;
  };
};

/** BR-PSL-100 deterministic priority order: variant -> product -> brand -> category -> global. */
const SCOPE_PRIORITY: readonly PriceEntryScopeType[] = [
  'variant',
  'product',
  'brand',
  'category',
  'global',
];

/**
 * ATHR Pricing Engine — WP-008 Phase B.
 *
 * Replaces the flat `cost * (1+overhead) * (1+profit) * (1+tax)` formula
 * read from `PricingRule` with deterministic resolution against active
 * `PriceBookEntry` rows (BR-PSL-100). This is **not** a zero-behavior-change
 * rewrite (WP-008 Phase B §B.4.7): a variant/qty combination that resolves
 * to no entry at any scope level now blocks pricing (`PRICING_NO_PRICE_
 * AVAILABLE`, BR-PSL-101) instead of silently falling back to a hardcoded
 * 20/35/14 default the way the pre-Phase-B engine did.
 *
 * `calculate`/`loadActiveRules`/`quote`/`quoteMany` keep the names and (for
 * `calculate`) the positional signature the existing `offers`/`sales`/`sync`
 * callers already depend on. `calculateMany` is the one method whose input
 * shape changes (`PriceableVariant[]` -> `PriceableLine[]`) — quantity
 * breaks are meaningless without a quantity, and only one caller
 * (`sales.service.ts`) uses it; see that file's diff in this same phase.
 */
@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  async calculate(
    context: TenantScope,
    variantId: string,
    transaction?: Prisma.TransactionClient,
    qty = 1,
  ): Promise<PriceQuote> {
    const db = transaction || this.prisma;
    const [variant, entries] = await Promise.all([
      db.productVariant.findFirst({
        where: { id: variantId, tenant_id: context.tenantId },
        include: { product: true },
      }),
      this.loadActiveRules(context, transaction),
    ]);
    if (!variant) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Variant ${variantId} not found.`);
    }
    const result = this.quote(variant, entries, qty);
    if (!result) {
      throw new AthrDomainError(
        'PRICING_NO_PRICE_AVAILABLE',
        `No resolvable price for variant ${variantId} at qty ${qty}.`,
      );
    }
    return result;
  }

  /**
   * Prices many lines after one entry query. Throws listing every variant it
   * could not price (BR-PSL-101: no price blocks the sale, and a sale must
   * never complete with some lines silently unpriced).
   */
  async calculateMany(
    context: TenantScope,
    lines: readonly PriceableLine[],
    transaction?: Prisma.TransactionClient,
  ): Promise<Map<string, PriceQuote>> {
    const index = this.buildIndex(await this.loadActiveRules(context, transaction));
    const result = new Map<string, PriceQuote>();
    const unpriced: string[] = [];
    for (const line of lines) {
      const quote = this.quote(line.variant, index, line.qty);
      if (!quote) {
        unpriced.push(line.variant.id);
        continue;
      }
      result.set(line.variant.id, quote);
    }
    if (unpriced.length) {
      throw new AthrDomainError(
        'PRICING_NO_PRICE_AVAILABLE',
        `No resolvable price for variant(s): ${unpriced.join(', ')}.`,
      );
    }
    return result;
  }

  /**
   * Loads every currently-effective `PriceBookEntry` for the tenant's active
   * **default** Price Book. Scoped so another tenant's entries can never win
   * this tenant's resolution (Multi-tenancy Blueprint §32/§120 precedent —
   * same reasoning WP-007 documented for the old `PricingRule` query).
   *
   * `is_default` matters as much as `status`: without it, a non-default
   * active book (a wholesale or contract book, BR-PRB-101) contributed its
   * entries to tenant-default resolution and bloated this result set with
   * rows that must never win here.
   */
  async loadActiveRules(
    context: TenantScope,
    transaction?: Prisma.TransactionClient,
  ): Promise<ResolvedPriceEntry[]> {
    const db = transaction || this.prisma;
    const now = new Date();
    return db.priceBookEntry.findMany({
      where: {
        tenant_id: context.tenantId,
        status: 'active',
        effective_from: { lte: now },
        OR: [{ effective_to: null }, { effective_to: { gte: now } }],
        price_book: { tenant_id: context.tenantId, status: 'active', is_default: true },
      },
    });
  }

  /** `"<scope_type>:<scope_id>"` — `global` entries collapse to a single bucket. */
  private static scopeKey(scopeType: PriceEntryScopeType, scopeId: string | null): string {
    return `${scopeType}:${scopeType === 'global' ? '' : scopeId ?? ''}`;
  }

  /** Buckets entries by resolution scope so `quote()` never scans the full tenant set. */
  buildIndex(entries: readonly ResolvedPriceEntry[]): PriceEntryIndex {
    const index = new Map<string, ResolvedPriceEntry[]>();
    for (const entry of entries) {
      const key = PricingService.scopeKey(entry.scope_type, entry.scope_id);
      const bucket = index.get(key);
      if (bucket) bucket.push(entry);
      else index.set(key, [entry]);
    }
    return index;
  }

  /**
   * Pure, synchronous resolution against a pre-loaded entry set — used for
   * bulk catalog snapshots (`sync`). Indexes once, then resolves each variant
   * against its own buckets, so a full-catalog snapshot is linear in the
   * number of variants rather than variants × entries.
   */
  quoteMany(
    variants: readonly PriceableVariant[],
    entries: readonly ResolvedPriceEntry[] | PriceEntryIndex,
  ): Map<string, PriceQuote> {
    const index = PricingService.asIndex(entries) ?? this.buildIndex(entries as readonly ResolvedPriceEntry[]);
    const result = new Map<string, PriceQuote>();
    for (const variant of variants) {
      const quote = this.quote(variant, index, 1);
      if (quote) result.set(variant.id, quote);
    }
    return result;
  }

  private static asIndex(
    entries: readonly ResolvedPriceEntry[] | PriceEntryIndex,
  ): PriceEntryIndex | null {
    return entries instanceof Map ? entries : null;
  }

  /**
   * BR-PSL-100/104: walks variant -> product -> brand -> category -> global;
   * at the first scope level with any entry qualifying for `qty` (its
   * `min_qty` <= `qty`), picks the entry with the highest qualifying
   * `min_qty` (the tightest quantity break the requested qty still clears).
   * Returns `null` — never a zero/negative fallback — when nothing resolves
   * (BR-PSL-101).
   */
  quote(
    variant: PriceableVariant,
    entries: readonly ResolvedPriceEntry[] | PriceEntryIndex,
    qty = 1,
  ): PriceQuote | null {
    const index = PricingService.asIndex(entries) ?? this.buildIndex(entries as readonly ResolvedPriceEntry[]);
    const levels: ReadonlyArray<{ type: PriceEntryScopeType; id: string | null }> = [
      { type: 'variant', id: variant.id },
      { type: 'product', id: variant.product_id },
      { type: 'brand', id: variant.product.brand_id ?? null },
      { type: 'category', id: variant.product.category_id ?? null },
      { type: 'global', id: null },
    ];

    for (const level of SCOPE_PRIORITY) {
      const target = levels.find((candidate) => candidate.type === level)!;
      if (target.type !== 'global' && !target.id) continue;

      const bucket = index.get(PricingService.scopeKey(target.type, target.id)) ?? [];
      const candidates = bucket.filter((entry) => decimal(entry.min_qty).lte(qty));
      if (!candidates.length) continue;

      const winner = candidates.reduce((best, current) =>
        decimal(current.min_qty).gt(decimal(best.min_qty)) ? current : best,
      );
      return this.priceFromEntry(variant, winner, qty);
    }
    return null;
  }

  private priceFromEntry(variant: PriceableVariant, entry: ResolvedPriceEntry, qty: number): PriceQuote {
    const netPrice = money(entry.unit_price);
    const taxPercent = decimal(entry.tax_percent);
    const taxAmount = money(netPrice.mul(taxPercent).div(100));
    const sellingPrice = money(netPrice.plus(taxAmount));
    const floorIsCostDerived = entry.floor_price == null;
    const floor = floorIsCostDerived ? money(variant.cost_price) : money(entry.floor_price!);

    return {
      qty,
      unit_price: netPrice.toNumber(),
      net_price: netPrice.toNumber(),
      tax_percent: taxPercent.toNumber(),
      tax_amount: taxAmount.toNumber(),
      selling_price: sellingPrice.toNumber(),
      min_allowed_price: floor.toNumber(),
      floor_is_cost_derived: floorIsCostDerived,
      source: {
        price_book_id: entry.price_book_id,
        entry_id: entry.id,
        scope_type: entry.scope_type,
        scope_id: entry.scope_id,
        min_qty: decimal(entry.min_qty).toNumber(),
      },
    };
  }
}
