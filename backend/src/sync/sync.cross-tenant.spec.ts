import { randomUUID } from 'crypto';
import { SyncService } from './sync.service';
import { PricingService } from '../pricing/pricing.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `sync` module.
 *
 * Multi-tenancy Blueprint §123: "Resync cannot return another Tenant data".
 * This is the feed that populates every POS device's local database, so a
 * missing predicate here does not just leak a query result — it writes
 * another tenant's catalogue and prices onto a physical till.
 */

const PRODUCT_A = randomUUID();
const PRODUCT_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const PRICE_BOOK_A = randomUUID();
const PRICE_BOOK_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    syncChange: [
      { sequence: 1n, tenant_id: TENANT_A, kind: 'product', branch_id: null, entity_key: null },
      { sequence: 2n, tenant_id: TENANT_B, kind: 'product', branch_id: null, entity_key: null },
    ],
    product: [
      { id: PRODUCT_A, tenant_id: TENANT_A, name_en: 'A widget', name_ar: null, is_active: true },
      { id: PRODUCT_B, tenant_id: TENANT_B, name_en: 'B widget', name_ar: null, is_active: true },
    ],
    productVariant: [
      {
        id: VARIANT_A,
        tenant_id: TENANT_A,
        product_id: PRODUCT_A,
        sku: 'A-1',
        is_active: true,
        cost_price: 10,
        product: { id: PRODUCT_A, tenant_id: TENANT_A, name_en: 'A widget', name_ar: null, is_active: true },
      },
      {
        id: VARIANT_B,
        tenant_id: TENANT_B,
        product_id: PRODUCT_B,
        sku: 'B-1',
        is_active: true,
        cost_price: 10,
        product: { id: PRODUCT_B, tenant_id: TENANT_B, name_en: 'B widget', name_ar: null, is_active: true },
      },
    ],
    inventoryStock: [
      { tenant_id: TENANT_A, branch_id: BRANCH_A, variant_id: VARIANT_A, qty_on_hand: 3 },
      { tenant_id: TENANT_B, branch_id: BRANCH_B, variant_id: VARIANT_B, qty_on_hand: 7 },
    ],
    priceBook: [
      { id: PRICE_BOOK_A, tenant_id: TENANT_A, status: 'active', is_default: true },
      { id: PRICE_BOOK_B, tenant_id: TENANT_B, status: 'active', is_default: true },
    ],
    priceBookEntry: [
      {
        id: randomUUID(), tenant_id: TENANT_A, price_book_id: PRICE_BOOK_A,
        scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 20,
        allow_zero_price: false, tax_percent: 14, floor_price: null,
        effective_from: new Date(0), effective_to: null, status: 'active',
      },
      {
        id: randomUUID(), tenant_id: TENANT_B, price_book_id: PRICE_BOOK_B,
        scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 30,
        allow_zero_price: false, tax_percent: 14, floor_price: null,
        effective_from: new Date(0), effective_to: null, status: 'active',
      },
    ],
    pricingRule: [],
    user: [],
  }, {
    productVariant: { product: { table: 'product', localKey: 'product_id' } },
    priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } },
  });
  prisma.syncChange.aggregate = async ({ where }: any) => {
    const rows = prisma.syncChange.rows.filter(
      (row: any) => !where?.tenant_id || row.tenant_id === where.tenant_id,
    );
    return { _max: { sequence: rows.at(-1)?.sequence ?? 0n } };
  };
  return { prisma, service: new SyncService(prisma, new PricingService(prisma)) };
}

describe('sync — cross-tenant isolation (Blueprint §123)', () => {
  it('snapshots only the calling tenant\'s catalogue onto a device', async () => {
    const { service } = setup();
    const forA: any = await service.pull(contextFor(TENANT_A), BRANCH_A);

    expect(forA.mode).toBe('snapshot');
    expect(forA.products.map((p: any) => p.sku)).toEqual(['A-1']);
    expect(forA.stock.map((s: any) => s.variant_id)).toEqual([VARIANT_A]);
  });

  it('gives a second tenant an entirely disjoint snapshot', async () => {
    const { service } = setup();
    const forB: any = await service.pull(contextFor(TENANT_B), BRANCH_B);

    expect(forB.products.map((p: any) => p.sku)).toEqual(['B-1']);
    expect(forB.products.map((p: any) => p.id)).not.toContain(VARIANT_A);
  });

  it('advances the delta cursor over the calling tenant\'s changes only', async () => {
    const { service } = setup();
    const forA: any = await service.pull(contextFor(TENANT_A), BRANCH_A, '0');

    // Tenant B's sequence-2 change must not appear in tenant A's delta.
    expect(forA.mode).toBe('delta');
    expect(forA.cursor).toBe('1');
    expect(forA.products.map((p: any) => p.sku)).toEqual(['A-1']);
  });

  it('does not return another tenant\'s stock for a foreign branch', async () => {
    const { service } = setup();
    const forA: any = await service.pull(contextFor(TENANT_A), BRANCH_B);
    expect(forA.stock).toEqual([]);
  });
});
