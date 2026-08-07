import { randomUUID } from 'crypto';
import { OverridesRepository } from './overrides.repository';
import { OverridesService } from './overrides.service';
import { PricingService } from './pricing.service';
import { CostVisibilityService } from './cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B — cross-tenant isolation for `PriceOverride`/`Discount`/`PriceOverridePolicy`. */

const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();

function setup() {
  const prisma = fakePrisma(
    {
      productVariant: [
        { id: VARIANT_A, tenant_id: TENANT_A, product_id: randomUUID(), cost_price: 50, product: { category_id: null, brand_id: null } },
        { id: VARIANT_B, tenant_id: TENANT_B, product_id: randomUUID(), cost_price: 50, product: { category_id: null, brand_id: null } },
      ],
      priceBook: [
        { id: 'book-a', tenant_id: TENANT_A, status: 'active', is_default: true },
        { id: 'book-b', tenant_id: TENANT_B, status: 'active', is_default: true },
      ],
      priceBookEntry: [
        { id: 'entry-a', tenant_id: TENANT_A, price_book_id: 'book-a', scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 100, allow_zero_price: false, tax_percent: 0, floor_price: null, effective_from: new Date(0), effective_to: null, status: 'active' },
        { id: 'entry-b', tenant_id: TENANT_B, price_book_id: 'book-b', scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 200, allow_zero_price: false, tax_percent: 0, floor_price: null, effective_from: new Date(0), effective_to: null, status: 'active' },
      ],
      priceOverridePolicy: [],
      priceOverride: [],
      discount: [],
    },
    { priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } } },
  );
  const pricing = new PricingService(prisma);
  const repository = new OverridesRepository(prisma);
  const permissionPolicy = { hasPermission: jest.fn().mockResolvedValue(false) } as unknown as PermissionPolicyService;
  const costVisibility = new CostVisibilityService({ hasPermission: async () => true } as unknown as PermissionPolicyService);
  return { prisma, repository, service: new OverridesService(repository, pricing, permissionPolicy, costVisibility) };
}

function actor(overrides: Record<string, unknown> = {}) {
  return { sub: randomUUID(), role: 'cashier', branch_id: null, membership_role: 'cashier', ...overrides } as any;
}

describe('overrides/discounts — cross-tenant isolation', () => {
  it('cannot apply an override against another tenant\'s variant', async () => {
    const { service } = setup();
    await expect(
      service.applyOverride(contextFor(TENANT_B), actor(), {
        variant_id: VARIANT_A, qty: 1, override_price: 90, reason: 'x',
      } as any),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('stamps an applied override with the calling tenant and lists only that tenant\'s overrides', async () => {
    const { service, repository } = setup();
    await service.applyOverride(contextFor(TENANT_A), actor(), {
      variant_id: VARIANT_A, qty: 1, override_price: 90, reason: 'x',
    } as any);
    await service.applyOverride(contextFor(TENANT_B), actor(), {
      variant_id: VARIANT_B, qty: 1, override_price: 190, reason: 'y',
    } as any);

    const overridesA = await repository.listOverrides(contextFor(TENANT_A));
    const overridesB = await repository.listOverrides(contextFor(TENANT_B));
    expect(overridesA).toHaveLength(1);
    expect(overridesB).toHaveLength(1);
    expect(overridesA[0].tenant_id).toBe(TENANT_A);
    expect(overridesB[0].tenant_id).toBe(TENANT_B);
  });

  it('does not apply another tenant\'s PriceOverridePolicy limit', async () => {
    const { prisma, service } = setup();
    prisma.priceOverridePolicy.rows.push(
      { id: randomUUID(), tenant_id: TENANT_A, role: 'cashier', max_discount_percent: 1 },
      { id: randomUUID(), tenant_id: TENANT_B, role: 'cashier', max_discount_percent: 90 },
    );
    // Tenant A's cashier policy caps discounts at 1% -- a 10% discount must
    // be rejected using tenant A's own policy, not tenant B's looser one.
    await expect(
      service.applyOverride(contextFor(TENANT_A), actor(), {
        variant_id: VARIANT_A, qty: 1, override_price: 90, reason: 'x',
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('stamps an applied discount with the calling tenant and lists only that tenant\'s discounts', async () => {
    const { service, repository } = setup();
    await service.applyDiscount(contextFor(TENANT_A), actor(), {
      variant_id: VARIANT_A, qty: 1, basis: 'percentage', amount: 5,
    } as any);
    const discountsA = await repository.listDiscounts(contextFor(TENANT_A));
    const discountsB = await repository.listDiscounts(contextFor(TENANT_B));
    expect(discountsA).toHaveLength(1);
    expect(discountsB).toHaveLength(0);
  });
});
