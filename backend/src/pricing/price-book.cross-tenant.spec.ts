import { randomUUID } from 'crypto';
import { PriceBookRepository } from './price-book.repository';
import { PriceBookService } from './price-book.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B — cross-tenant isolation for `PriceBook`/`PriceBookEntry`. */

const BOOK_A = randomUUID();
const BOOK_B = randomUUID();
const MAKER_A = randomUUID();

function setup() {
  const prisma = fakePrisma({
    tenant: [
      { id: TENANT_A, default_currency: 'EGP' },
      { id: TENANT_B, default_currency: 'EGP' },
    ],
    priceBook: [
      { id: BOOK_A, tenant_id: TENANT_A, name: 'A', currency: 'EGP', scope: 'tenant_default', scope_ref_id: null, status: 'draft', is_default: false, created_by: MAKER_A, submitted_by: null },
      { id: BOOK_B, tenant_id: TENANT_B, name: 'B', currency: 'EGP', scope: 'tenant_default', scope_ref_id: null, status: 'draft', is_default: false, created_by: null, submitted_by: null },
    ],
    priceBookEntry: [],
  });
  const repository = new PriceBookRepository(prisma);
  const permissionPolicy = { hasPermission: async () => true } as any;
  return { prisma, repository, service: new PriceBookService(repository, prisma, permissionPolicy) };
}

describe('price books — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s Price Books', async () => {
    const { service } = setup();
    const { rows: rowsA } = await service.list(contextFor(TENANT_A), {} as any);
    const { rows: rowsB } = await service.list(contextFor(TENANT_B), {} as any);
    expect(rowsA.map((row) => row.id)).toEqual([BOOK_A]);
    expect(rowsB.map((row) => row.id)).toEqual([BOOK_B]);
  });

  it('does not resolve another tenant\'s Price Book by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), BOOK_A)).toBeNull();
  });

  it('refuses to transition another tenant\'s Price Book', async () => {
    const { service } = setup();
    await expect(service.submit(contextFor(TENANT_B), MAKER_A, BOOK_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('stamps a new Price Book with the calling tenant', async () => {
    const { repository, service } = setup();
    const created = await service.create(contextFor(TENANT_B), randomUUID(), { name: 'New Book' } as any);
    expect(created.tenant_id).toBe(TENANT_B);
    expect(await repository.findById(contextFor(TENANT_A), created.id)).toBeNull();
  });

  it('does not let one tenant\'s default-book supersede logic touch another tenant\'s active book', async () => {
    const { prisma, service, repository } = setup();
    const otherTenantsActiveDefault = randomUUID();
    prisma.priceBook.rows.push({
      id: otherTenantsActiveDefault,
      tenant_id: TENANT_B,
      name: 'B active default',
      currency: 'EGP',
      scope: 'tenant_default',
      scope_ref_id: null,
      status: 'active',
      is_default: true,
    });
    const scheduledForA = randomUUID();
    prisma.priceBook.rows.push({
      id: scheduledForA,
      tenant_id: TENANT_A,
      name: 'A new default',
      currency: 'EGP',
      scope: 'tenant_default',
      scope_ref_id: null,
      status: 'scheduled',
      is_default: true,
      submitted_by: MAKER_A,
      approved_by: MAKER_A,
    });

    await service.activate(contextFor(TENANT_A), MAKER_A, scheduledForA);

    const otherTenantsBookAfter = await repository.findById(contextFor(TENANT_B), otherTenantsActiveDefault);
    expect(otherTenantsBookAfter!.status).toBe('active');
    expect(otherTenantsBookAfter!.is_default).toBe(true);
  });

  it('lists only the calling tenant\'s entries', async () => {
    const { prisma, service } = setup();
    prisma.priceBookEntry.rows.push(
      { id: randomUUID(), tenant_id: TENANT_A, price_book_id: BOOK_A, scope_type: 'global', scope_id: null, status: 'active', min_qty: 1, unit_price: 10 },
      { id: randomUUID(), tenant_id: TENANT_B, price_book_id: BOOK_B, scope_type: 'global', scope_id: null, status: 'active', min_qty: 1, unit_price: 20 },
    );
    const entriesA = await service.listEntries(contextFor(TENANT_A));
    const entriesB = await service.listEntries(contextFor(TENANT_B));
    expect(entriesA).toHaveLength(1);
    expect(entriesB).toHaveLength(1);
    expect(entriesA[0].tenant_id).toBe(TENANT_A);
    expect(entriesB[0].tenant_id).toBe(TENANT_B);
  });
});
