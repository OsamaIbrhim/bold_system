import { randomUUID } from 'crypto';
import { PriceBookRepository } from './price-book.repository';
import { PriceBookService } from './price-book.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B (BR-PRB-1xx, Permission Matrix §17): the Price Book maker-checker lifecycle. */

const ctx = contextFor(TENANT_A);
const MAKER = randomUUID();
const CHECKER = randomUUID();

/**
 * Entry mutation on an *active* book additionally requires
 * `pricing.price-book.activate` (Matrix §17) — these fakes stand in for the
 * two sides of that check without booting the real policy snapshot.
 */
const PRICING_MANAGER = { sub: MAKER, membership_role: 'location_manager' } as any;
const ENTRY_CLERK = { sub: MAKER, membership_role: 'warehouse_manager' } as any;

function fakePermissionPolicy() {
  return {
    hasPermission: async (role: string, permission: string) =>
      role === 'location_manager' || role === 'tenant_owner'
        ? true
        : permission !== 'pricing.price-book.activate',
  } as any;
}

function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenant_id: TENANT_A,
    name: 'Default',
    currency: 'EGP',
    scope: 'tenant_default',
    scope_ref_id: null,
    status: 'draft',
    is_default: false,
    effective_from: null,
    effective_to: null,
    created_by: MAKER,
    submitted_by: null,
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    scheduled_by: null,
    scheduled_at: null,
    activated_by: null,
    activated_at: null,
    ended_by: null,
    ended_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(rows: ReturnType<typeof bookRow>[] = [], entryRows: Record<string, unknown>[] = []) {
  const prisma = fakePrisma({
    tenant: [{ id: TENANT_A, default_currency: 'EGP' }],
    priceBook: rows,
    priceBookEntry: entryRows,
  });
  const repository = new PriceBookRepository(prisma);
  return {
    prisma,
    repository,
    service: new PriceBookService(repository, prisma, fakePermissionPolicy()),
  };
}

describe('PriceBookService — create (BR-PRB-100, OD-CAT-005 single currency)', () => {
  it('defaults currency to the tenant\'s operating currency', async () => {
    const { service } = setup();
    const book = await service.create(ctx, MAKER, { name: 'Default' } as any);
    expect(book.currency).toBe('EGP');
  });

  it('rejects a currency other than the tenant\'s operating currency', async () => {
    const { service } = setup();
    await expect(
      service.create(ctx, MAKER, { name: 'Default', currency: 'USD' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_CURRENCY_MISMATCH' });
  });
});

describe('PriceBookService — lifecycle (BR-PRB-101)', () => {
  it('walks draft -> submitted -> approved -> scheduled -> active -> ended', async () => {
    const book = bookRow();
    const { service, repository } = setup([book]);

    await service.submit(ctx, MAKER, book.id);
    let current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('submitted');
    expect(current!.submitted_by).toBe(MAKER);

    await service.approve(ctx, CHECKER, book.id);
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('approved');
    expect(current!.approved_by).toBe(CHECKER);

    await service.schedule(ctx, CHECKER, book.id, {});
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('scheduled');

    await service.activate(ctx, CHECKER, book.id);
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('active');
    expect(current!.activated_by).toBe(CHECKER);

    await service.end(ctx, CHECKER, book.id);
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('ended');
  });

  it('rejects an out-of-order transition (approve before submit)', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(service.approve(ctx, CHECKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION',
    });
  });

  it('rejects activating a book that has not been scheduled', async () => {
    const book = bookRow({ status: 'approved', submitted_by: MAKER, approved_by: CHECKER });
    const { service } = setup([book]);
    await expect(service.activate(ctx, CHECKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION',
    });
  });

  it('Matrix §17 "Separation": blocks the submitter from approving their own submission', async () => {
    const book = bookRow({ status: 'submitted', created_by: CHECKER, submitted_by: MAKER });
    const { service } = setup([book]);
    await expect(service.approve(ctx, MAKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
    });
  });

  // Matrix §63 pairs "Price book creator" with "Approver" — checking only
  // `submitted_by` left create -> colleague submits -> approve your own book
  // wide open.
  it('Matrix §63 "Separation": blocks the creator from approving, even when someone else submitted', async () => {
    const book = bookRow({ status: 'submitted', created_by: MAKER, submitted_by: CHECKER });
    const { service } = setup([book]);
    await expect(service.approve(ctx, MAKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('allows a genuinely independent approver (neither creator nor submitter)', async () => {
    const independent = randomUUID();
    const book = bookRow({ status: 'submitted', created_by: MAKER, submitted_by: CHECKER });
    const { service } = setup([book]);
    const approved = await service.approve(ctx, independent, book.id);
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe(independent);
  });

  it('BR-PRB-104: activating a new default book ends the previous default for the same (currency, scope)', async () => {
    const oldDefault = bookRow({
      status: 'active', is_default: true, activated_by: CHECKER,
    });
    const newDefault = bookRow({
      status: 'scheduled', is_default: true, submitted_by: MAKER, approved_by: CHECKER,
    });
    const { service, repository } = setup([oldDefault, newDefault]);

    await service.activate(ctx, CHECKER, newDefault.id);

    const oldAfter = await repository.findById(ctx, oldDefault.id);
    const newAfter = await repository.findById(ctx, newDefault.id);
    expect(oldAfter!.status).toBe('ended');
    expect(oldAfter!.is_default).toBe(false);
    expect(newAfter!.status).toBe('active');
    expect(newAfter!.is_default).toBe(true);
  });
});

describe('PriceBookService — entries (BR-PRB-102/103 versioning, BR-PSL-102/103 price validation)', () => {
  it('rejects a negative unit_price', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, PRICING_MANAGER, {
        price_book_id: book.id, scope_type: 'global', unit_price: -1,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED' });
  });

  it('rejects a zero unit_price without allow_zero_price', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, PRICING_MANAGER, {
        price_book_id: book.id, scope_type: 'global', unit_price: 0,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED' });
  });

  it('accepts a zero unit_price with allow_zero_price (BR-PSL-102)', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const created = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 0, allow_zero_price: true,
    } as any);
    expect(created.unit_price.toString()).toBe('0');
  });

  it('requires scope_id unless scope_type is "global"', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, PRICING_MANAGER, {
        price_book_id: book.id, scope_type: 'variant', unit_price: 100,
      } as any),
    ).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
  });

  it('supersede creates a new version and marks the previous entry superseded, never edits it in place', async () => {
    const book = bookRow();
    const { service, repository } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);

    const v2 = await service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, { unit_price: 120 } as any);

    const v1After = await repository.findEntryById(ctx, v1.id);
    expect(v1After!.status).toBe('superseded');
    expect(v1After!.unit_price.toString()).toBe('100');
    expect(v1After!.superseded_by_id).toBe(v2.id);
    expect(v2.status).toBe('active');
    expect(v2.version).toBe(2);
    expect(v2.unit_price.toString()).toBe('120');
  });

  it('rejects superseding an already-superseded entry directly', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);
    await service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, { unit_price: 120 } as any);

    await expect(
      service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, { unit_price: 130 } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ENTRY_IMMUTABLE' });
  });

  it('rejects managing entries on an ended book', async () => {
    const book = bookRow({ status: 'ended' });
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, PRICING_MANAGER, {
        price_book_id: book.id, scope_type: 'global', unit_price: 100,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION' });
  });

  // H1: a supersede that only moves the price must inherit everything else
  // from the entry it replaces, never reset it to a literal default.
  it('supersede inherits tax_percent/floor_price/allow_zero_price from the previous entry when the DTO omits them', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
      tax_percent: 5, floor_price: 80,
    } as any);
    expect(v1.tax_percent.toString()).toBe('5');

    const v2 = await service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, { unit_price: 120 } as any);

    expect(v2.tax_percent.toString()).toBe('5');
    expect(v2.floor_price!.toString()).toBe('80');
    expect(v2.allow_zero_price).toBe(false);
  });

  it('supersede still honours values the DTO does supply', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
      tax_percent: 5, floor_price: 80,
    } as any);

    const v2 = await service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, {
      unit_price: 120, tax_percent: 14, floor_price: 90,
    } as any);

    expect(v2.tax_percent.toString()).toBe('14');
    expect(v2.floor_price!.toString()).toBe('90');
  });

  it('inherits allow_zero_price for validation too — a zero-priced entry can be superseded at zero', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 0, allow_zero_price: true,
    } as any);

    const v2 = await service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, { unit_price: 0 } as any);
    expect(v2.allow_zero_price).toBe(true);
    expect(v2.unit_price.toString()).toBe('0');
  });
});

/**
 * B8 — `PriceBookEntry_one_active_per_scope_qty` is a partial unique index
 * over (price_book_id, scope_type, COALESCE(scope_id,...), min_qty) WHERE
 * status = 'active', and Postgres checks a non-deferrable unique index per
 * statement, not at COMMIT. Inserting the successor before demoting the
 * previous row therefore raised P2002 on a real database while passing here
 * (`fakePrisma` has no index to violate) — this test pins the order, and
 * `scripts/verify-price-book-behaviour.cjs` proves it against real Postgres.
 */
describe('PriceBookService — a database uniqueness conflict never leaks as a raw Prisma error', () => {
  function prismaRejectingWith(code: string) {
    return {
      tenant: { findUnique: async () => ({ id: TENANT_A, default_currency: 'EGP' }) },
      priceBook: {
        findFirst: async () => bookRow({ status: 'draft' }),
        create: async () => {
          throw Object.assign(new Error('unique constraint'), { code });
        },
      },
      priceBookEntry: {
        create: async () => {
          throw Object.assign(new Error('unique constraint'), { code });
        },
      },
    } as any;
  }

  function serviceFor(prisma: any) {
    return new PriceBookService(new PriceBookRepository(prisma), prisma, fakePermissionPolicy());
  }

  it('maps the default-book index collision to PRICING_DEFAULT_PRICE_BOOK_CONFLICT', async () => {
    const service = serviceFor(prismaRejectingWith('P2002'));
    await expect(
      service.create(ctx, MAKER, { name: 'Second default', is_default: true } as any),
    ).rejects.toMatchObject({ code: 'PRICING_DEFAULT_PRICE_BOOK_CONFLICT' });
  });

  it('maps the one-active-entry-per-scope collision to PRICING_ENTRY_IMMUTABLE', async () => {
    const service = serviceFor(prismaRejectingWith('P2002'));
    await expect(
      service.createEntry(ctx, PRICING_MANAGER, {
        price_book_id: randomUUID(), scope_type: 'global', unit_price: 100,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ENTRY_IMMUTABLE' });
  });

  it('re-throws any error that is not a uniqueness violation', async () => {
    const service = serviceFor(prismaRejectingWith('P1001'));
    await expect(
      service.create(ctx, MAKER, { name: 'x', is_default: true } as any),
    ).rejects.toMatchObject({ code: 'P1001' });
  });
});

describe('PriceBookRepository — supersede demotes the previous version before inserting the successor', () => {
  it('issues the demoting updateMany first, carrying the successor id', async () => {
    const calls: string[] = [];
    const previous = {
      id: 'entry-1', tenant_id: TENANT_A, price_book_id: 'book-1', scope_type: 'global',
      scope_id: null, min_qty: 1, version: 1, status: 'active',
    };
    let demotedWith: any = null;
    const prisma = {
      priceBookEntry: {
        findFirst: async () => previous,
      },
      $transaction: async (fn: any) =>
        fn({
          priceBookEntry: {
            updateMany: async (args: any) => {
              calls.push('updateMany');
              demotedWith = args;
              return { count: 1 };
            },
            create: async ({ data }: any) => {
              calls.push('create');
              return data;
            },
          },
        }),
    } as any;

    const created: any = await new PriceBookRepository(prisma).supersedeEntry(ctx, 'entry-1', {
      unitPrice: 120, allowZeroPrice: false, taxPercent: 14, floorPrice: null, createdBy: MAKER,
    });

    expect(calls).toEqual(['updateMany', 'create']);
    expect(demotedWith.where).toMatchObject({ id: 'entry-1', status: 'active' });
    expect(demotedWith.data.superseded_by_id).toBe(created.id);
    expect(created.version).toBe(2);
  });

  it('refuses to insert a successor when the previous version was superseded concurrently', async () => {
    const prisma = {
      priceBookEntry: {
        findFirst: async () => ({
          id: 'entry-1', tenant_id: TENANT_A, price_book_id: 'book-1', scope_type: 'global',
          scope_id: null, min_qty: 1, version: 1, status: 'active',
        }),
      },
      $transaction: async (fn: any) =>
        fn({
          priceBookEntry: {
            updateMany: async () => ({ count: 0 }),
            create: async () => {
              throw new Error('must not insert a second active version');
            },
          },
        }),
    } as any;

    await expect(
      new PriceBookRepository(prisma).supersedeEntry(ctx, 'entry-1', {
        unitPrice: 120, allowZeroPrice: false, taxPercent: 14, floorPrice: null, createdBy: MAKER,
      }),
    ).rejects.toMatchObject({ code: 'PRICING_ENTRY_IMMUTABLE' });
  });
});

/**
 * H2 (BR-PRB-101/103, Permission Matrix §17): a `draft` book is not live, so
 * `pricing.price-entry.manage` alone builds it up; an `active` book is, so
 * changing a live price additionally requires `pricing.price-book.activate`.
 */
describe('PriceBookService — entries on a live book require publish authority', () => {
  it('lets a price-entry manager without publish authority write to a draft book', async () => {
    const book = bookRow({ status: 'draft' });
    const { service } = setup([book]);
    const created = await service.createEntry(ctx, ENTRY_CLERK, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);
    expect(created.status).toBe('active');
  });

  it('blocks that same actor from creating an entry on an ACTIVE book', async () => {
    const book = bookRow({ status: 'active', is_default: true });
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, ENTRY_CLERK, {
        price_book_id: book.id, scope_type: 'global', unit_price: 100,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION' });
  });

  it('blocks that same actor from superseding an entry on an ACTIVE book', async () => {
    const book = bookRow({ status: 'active', is_default: true });
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);

    await expect(
      service.supersedeEntry(ctx, ENTRY_CLERK, v1.id, { unit_price: 1 } as any),
    ).rejects.toMatchObject({ code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION' });
  });

  it('allows an actor holding pricing.price-book.activate to reprice a live book (BR-PRB-103)', async () => {
    const book = bookRow({ status: 'active', is_default: true });
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, PRICING_MANAGER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);

    const v2 = await service.supersedeEntry(ctx, PRICING_MANAGER, v1.id, { unit_price: 120 } as any);
    expect(v2.version).toBe(2);
    expect(v2.unit_price.toString()).toBe('120');
  });
});
