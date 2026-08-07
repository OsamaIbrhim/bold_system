import { randomUUID } from 'crypto';
import { OverridesRepository } from './overrides.repository';
import { OverridesService } from './overrides.service';
import { PricingService } from './pricing.service';
import { CostVisibilityService } from './cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B (BR-OVP-1xx, BR-DSC-2xx): override vs. discount separation, floor approval. */

const ctx = contextFor(TENANT_A);
const VARIANT_ID = randomUUID();

function actor(overrides: Record<string, unknown> = {}) {
  return {
    sub: randomUUID(),
    role: 'cashier',
    branch_id: null,
    membership_role: 'cashier',
    ...overrides,
  } as any;
}

function setup(options: {
  policy?: Record<string, unknown> | null;
  hasAboveThreshold?: boolean;
  /** BR-CST-101: `pricing.cost.view`/`pricing.margin.view`. Cashier has neither. */
  hasCostView?: boolean;
} = {}) {
  const prisma = fakePrisma({
    productVariant: [
      { id: VARIANT_ID, tenant_id: TENANT_A, product_id: randomUUID(), cost_price: 50, product: { category_id: null, brand_id: null } },
    ],
    priceBook: [{ id: 'book-1', tenant_id: TENANT_A, status: 'active', is_default: true }],
    priceBookEntry: [
      {
        id: 'entry-1', tenant_id: TENANT_A, price_book_id: 'book-1', scope_type: 'global',
        scope_id: null, min_qty: 1, unit_price: 100, allow_zero_price: false, tax_percent: 0,
        floor_price: 80, effective_from: new Date(0), effective_to: null, status: 'active',
      },
    ],
    priceOverridePolicy: options.policy === null ? [] : [
      { id: randomUUID(), tenant_id: TENANT_A, role: 'cashier', ...options.policy },
    ],
    priceOverride: [],
    discount: [],
  }, {
    priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } },
  });
  const pricing = new PricingService(prisma);
  const overridesRepo = new OverridesRepository(prisma);
  const permissionPolicy = {
    hasPermission: jest.fn().mockResolvedValue(options.hasAboveThreshold ?? false),
  } as unknown as PermissionPolicyService;
  // A separate policy double for cost visibility, so the assertions about
  // *which* permission the override path checks stay meaningful.
  const costVisibility = new CostVisibilityService({
    hasPermission: async () => options.hasCostView ?? false,
  } as unknown as PermissionPolicyService);
  return {
    prisma,
    service: new OverridesService(overridesRepo, pricing, permissionPolicy, costVisibility),
    permissionPolicy,
  };
}

describe('OverridesService — manual override vs. discount are distinct entities (BR-OVP-100)', () => {
  it('records an override as a PriceOverride row distinct from a Discount row', async () => {
    const { service, prisma } = setup({ policy: {} });
    await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'loyalty match',
    } as any);

    expect(prisma.priceOverride.rows).toHaveLength(1);
    expect(prisma.discount.rows).toHaveLength(0);
    const row = prisma.priceOverride.rows[0];
    expect(row.base_price.toString()).toBe('100');
    expect(row.override_price.toString()).toBe('90');
    expect(row.is_below_floor).toBe(false);
    expect(row.reason).toBe('loyalty match');
  });

  it('records a discount as a Discount row distinct from a PriceOverride row', async () => {
    const { service, prisma } = setup({ policy: {} });
    await service.applyDiscount(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, basis: 'percentage', amount: 10,
    } as any);

    expect(prisma.discount.rows).toHaveLength(1);
    expect(prisma.priceOverride.rows).toHaveLength(0);
    const row = prisma.discount.rows[0];
    expect(row.base_price.toString()).toBe('100');
    expect(row.final_price.toString()).toBe('90');
    expect(row.basis).toBe('percentage');
    expect(row.amount).toBe(10);
  });
});

describe('OverridesService — role-based override limits (BR-OVP-101)', () => {
  it('rejects a discount percentage beyond the role\'s configured limit', async () => {
    const { service } = setup({ policy: { max_discount_percent: 5 } });
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('rejects a discount amount beyond the role\'s configured limit', async () => {
    const { service } = setup({ policy: { max_discount_amount: 5 } });
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('rejects a price increase when the role\'s policy disallows it', async () => {
    const { service } = setup({ policy: { allow_price_increase: false } });
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 110, reason: 'x' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('allows an override within the configured limit', async () => {
    const { service } = setup({ policy: { max_discount_percent: 20 } });
    const result = await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    expect(result.override_price.toString()).toBe('90');
  });

  it('allows any discount depth when the role has no configured policy row (still subject to the floor check)', async () => {
    const { service } = setup({ policy: null, hasAboveThreshold: true });
    // Below the entry's floor_price (80) -- allowed here only because this
    // actor also holds pricing.manual-override.above-threshold; a missing
    // policy row means "no configured limit", not "no floor check".
    const result = await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 5, reason: 'x',
    } as any);
    expect(result.override_price.toString()).toBe('5');
  });
});

describe('OverridesService — below-floor requires a separate approval permission (BR-OVP-102)', () => {
  it('rejects a below-floor override when the actor lacks pricing.manual-override.above-threshold', async () => {
    const { service } = setup({ policy: {}, hasAboveThreshold: false });
    // floor_price = 80 on the entry; 70 is below it.
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'clearance' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_BELOW_FLOOR_REQUIRES_APPROVAL' });
  });

  // H3 / Matrix §17 §63: holding `.above-threshold` authorizes *requesting* a
  // below-floor override. It is recorded PENDING — the applying actor is
  // never its own approver.
  it('records the below-floor override as PENDING approval, never self-approved', async () => {
    const { service, permissionPolicy } = setup({ policy: {}, hasAboveThreshold: true });
    const applier = actor();
    const result: any = await service.applyOverride(ctx, applier, {
      variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'clearance',
    } as any);

    expect(permissionPolicy.hasPermission).toHaveBeenCalledWith('cashier', 'pricing.manual-override.above-threshold');
    expect(result.is_below_floor).toBe(true);
    expect(result.approved_by).toBeNull();
    expect(result.approved_at).toBeNull();
  });

  it('never checks the above-threshold permission for an at-or-above-floor override (one permission does not imply the other)', async () => {
    const { service, permissionPolicy } = setup({ policy: {}, hasAboveThreshold: false });
    await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 85, reason: 'x',
    } as any);
    expect(permissionPolicy.hasPermission).not.toHaveBeenCalled();
  });
});

/** H3 — Permission Matrix §17/§63/§64: a genuinely separate approver identity. */
describe('OverridesService — below-floor approval is a separate act by a separate identity', () => {
  async function pendingOverride() {
    const harness = setup({ policy: {}, hasAboveThreshold: true, hasCostView: true });
    const applier = actor();
    const created: any = await harness.service.applyOverride(ctx, applier, {
      variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'clearance',
    } as any);
    return { ...harness, applier, created };
  }

  it('refuses to let the applying actor approve their own below-floor override', async () => {
    const { service, applier, created } = await pendingOverride();
    await expect(service.approveOverride(ctx, applier, created.id)).rejects.toMatchObject({
      code: 'PRICING_OVERRIDE_SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('records an independent approver', async () => {
    const { service, prisma, created } = await pendingOverride();
    const approver = actor({ membership_role: 'location_manager' });

    const approved: any = await service.approveOverride(ctx, approver, created.id);

    expect(approved.approved_by).toBe(approver.sub);
    expect(approved.approved_at).not.toBeNull();
    expect(prisma.priceOverride.rows[0].approved_by).toBe(approver.sub);
  });

  it('refuses to re-approve an already-approved override (the recorded approver is never overwritten)', async () => {
    const { service, created } = await pendingOverride();
    const approver = actor({ membership_role: 'location_manager' });
    await service.approveOverride(ctx, approver, created.id);

    const secondApprover = actor({ membership_role: 'location_manager' });
    await expect(service.approveOverride(ctx, secondApprover, created.id)).rejects.toMatchObject({
      code: 'PRICING_OVERRIDE_NOT_PENDING_APPROVAL',
    });
  });

  it('refuses to "approve" an override that was never below the floor', async () => {
    const { service } = setup({ policy: {}, hasCostView: true });
    const created: any = await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    await expect(service.approveOverride(ctx, actor(), created.id)).rejects.toMatchObject({
      code: 'PRICING_OVERRIDE_NOT_PENDING_APPROVAL',
    });
  });
});

/**
 * B3 — BR-CST-101 / Permission Matrix §51. The entry's floor is the variant's
 * `cost_price` whenever no explicit `floor_price` is set (which is every
 * migrated entry), so it must not reach a caller lacking
 * `pricing.cost.view`/`pricing.margin.view` on ANY path.
 */
describe('OverridesService — the floor is never disclosed without cost/margin visibility', () => {
  it('strips floor_price from the created override for a cashier', async () => {
    const { service } = setup({ policy: {}, hasCostView: false });
    const result: any = await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    expect(result).not.toHaveProperty('floor_price');
    expect(result.override_price.toString()).toBe('90');
  });

  it('returns floor_price to an actor holding cost/margin visibility', async () => {
    const { service } = setup({ policy: {}, hasCostView: true });
    const result: any = await service.applyOverride(ctx, actor({ membership_role: 'location_manager' }), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    expect(result.floor_price.toString()).toBe('80');
  });

  it('still persists the true floor for audit even when the response masks it', async () => {
    const { service, prisma } = setup({ policy: {}, hasCostView: false });
    await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    expect(prisma.priceOverride.rows[0].floor_price.toString()).toBe('80');
  });

  it('does not quote the floor in the REJECTED below-floor error message', async () => {
    const { service } = setup({ policy: {}, hasAboveThreshold: false, hasCostView: false });
    const error = await service
      .applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'x' } as any)
      .catch((e: any) => e);
    expect(error.code).toBe('PRICING_OVERRIDE_BELOW_FLOOR_REQUIRES_APPROVAL');
    expect(error.message).not.toContain('80');
    expect(error.message).toContain('configured floor');
  });

  it('does quote the floor in that message for an actor allowed to see cost', async () => {
    const { service } = setup({ policy: {}, hasAboveThreshold: false, hasCostView: true });
    const error = await service
      .applyOverride(ctx, actor({ membership_role: 'location_manager' }), {
        variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'x',
      } as any)
      .catch((e: any) => e);
    expect(error.message).toContain('80.00');
  });

  it('masks floor_price on the override list endpoint too', async () => {
    const { service } = setup({ policy: {}, hasCostView: false });
    await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    const rows: any[] = await service.listOverrides(ctx, actor());
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('floor_price');
  });
});

describe('OverridesService — discounts never go negative (BR-DSC-202)', () => {
  it('rejects a fixed-amount discount larger than the base price', async () => {
    const { service } = setup({ policy: {} });
    await expect(
      service.applyDiscount(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, basis: 'fixed_amount', amount: 500 } as any),
    ).rejects.toMatchObject({ code: 'PRICING_DISCOUNT_EXCEEDS_BASE_PRICE' });
  });

  it('rejects a percentage discount above 100', async () => {
    const { service } = setup({ policy: {} });
    await expect(
      service.applyDiscount(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, basis: 'percentage', amount: 150 } as any),
    ).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
  });
});
