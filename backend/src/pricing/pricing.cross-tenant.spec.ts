import { randomUUID } from 'crypto';
import { PricingService } from './pricing.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B — cross-tenant isolation for the `pricing` evaluation engine. */

const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const PRICE_BOOK_A = randomUUID();
const PRICE_BOOK_B = randomUUID();

function setup() {
  const prisma = fakePrisma(
    {
      productVariant: [
        {
          id: VARIANT_A,
          tenant_id: TENANT_A,
          product_id: randomUUID(),
          cost_price: 100,
          product: { category_id: null, brand_id: null },
        },
        {
          id: VARIANT_B,
          tenant_id: TENANT_B,
          product_id: randomUUID(),
          cost_price: 100,
          product: { category_id: null, brand_id: null },
        },
      ],
      priceBook: [
        { id: PRICE_BOOK_A, tenant_id: TENANT_A, status: 'active', is_default: true },
        { id: PRICE_BOOK_B, tenant_id: TENANT_B, status: 'active', is_default: true },
      ],
      priceBookEntry: [
        {
          id: randomUUID(),
          tenant_id: TENANT_A,
          price_book_id: PRICE_BOOK_A,
          scope_type: 'global',
          scope_id: null,
          min_qty: 1,
          unit_price: 150,
          allow_zero_price: false,
          tax_percent: 14,
          floor_price: null,
          effective_from: new Date(0),
          effective_to: null,
          status: 'active',
        },
        {
          id: randomUUID(),
          tenant_id: TENANT_B,
          price_book_id: PRICE_BOOK_B,
          scope_type: 'global',
          scope_id: null,
          min_qty: 1,
          unit_price: 0,
          allow_zero_price: true,
          tax_percent: 0,
          floor_price: null,
          effective_from: new Date(0),
          effective_to: null,
          status: 'active',
        },
      ],
    },
    {
      priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } },
    },
  );
  return { prisma, service: new PricingService(prisma) };
}

describe('pricing — cross-tenant isolation', () => {
  it('does not price another tenant\'s variant', async () => {
    const { service } = setup();
    await expect(service.calculate(contextFor(TENANT_B), VARIANT_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  /**
   * The sharpest failure mode in this module: entries are matched by scope,
   * so an unscoped query could let another tenant's "global" entry win and
   * silently reprice this tenant's whole catalogue.
   */
  it('applies only the calling tenant\'s Price Book entries', async () => {
    const { service } = setup();
    const quoteA = await service.calculate(contextFor(TENANT_A), VARIANT_A);
    const quoteB = await service.calculate(contextFor(TENANT_B), VARIANT_B);

    expect(quoteA.net_price).toBe(150);
    expect(quoteA.selling_price).toBeGreaterThan(150);

    // Tenant B's own entry is a free (zero-price, zero-tax) item.
    expect(quoteB.net_price).toBe(0);
    expect(quoteB.selling_price).toBe(0);
  });

  it('loads only the calling tenant\'s active entries', async () => {
    const { service } = setup();
    const entriesA = await service.loadActiveRules(contextFor(TENANT_A));
    const entriesB = await service.loadActiveRules(contextFor(TENANT_B));
    expect(entriesA).toHaveLength(1);
    expect(entriesB).toHaveLength(1);
    expect(entriesA[0]).not.toEqual(entriesB[0]);
  });

  it('never resolves another tenant\'s Price Book entry even if scope_id happened to collide', async () => {
    const { prisma, service } = setup();
    // Simulate a collision: tenant B creates a variant-scoped entry using
    // tenant A's variant id as its scope_id (impossible via the app layer,
    // since PriceBookService always stamps tenant_id, but this proves the
    // read path itself can't be fooled by matching scope_id alone).
    prisma.priceBookEntry.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_B,
      price_book_id: PRICE_BOOK_B,
      scope_type: 'variant',
      scope_id: VARIANT_A,
      min_qty: 1,
      unit_price: 999,
      allow_zero_price: false,
      tax_percent: 0,
      floor_price: null,
      effective_from: new Date(0),
      effective_to: null,
      status: 'active',
    });
    const quoteA = await service.calculate(contextFor(TENANT_A), VARIANT_A);
    expect(quoteA.net_price).toBe(150);
  });
});
