#!/usr/bin/env node
// WP-008 Phase B — database-level proof for the three defects whose fixes
// live in SQL, not in application code. Runs against a real, freshly-migrated
// Postgres (wired into the CI `migration-gate` job's `athr_migrations_clean`
// database), same convention as `verify-tenant-constraints.cjs`: the `backend`
// jest job has no live database, so a spec against `fakePrisma` can only prove
// what the fake does — which is exactly how the original PR shipped a
// "supersede the default Price Book" spec that passed on a path the real
// database forbids.
//
// Proves:
//   B1  Writing a PriceBookEntry (insert, supersede, delete) emits a
//       kind='pricing' SyncChange row carrying the right tenant, and
//       activating/ending a PriceBook does too — while a draft-stage
//       transition (draft -> submitted) does NOT, since kind='pricing'
//       forces a full catalog reset on every terminal.
//   B5  A replacement default Price Book can actually be created and taken
//       through its lifecycle alongside the live default, and the swap
//       leaves exactly one active default — the invariant BR-PRB-104 wants,
//       rather than the "no replacement can ever exist" the unscoped index
//       enforced. Also proves a *second active* default is still rejected.
//   B8  `PriceBookRepository.supersedeEntry`'s statement order survives the
//       `PriceBookEntry_one_active_per_scope_qty` partial unique index. Found
//       *by* this proof: the shipped order (insert successor, then demote the
//       previous row) raised P2002 on a real database while passing against
//       `fakePrisma` -- BR-PRB-103's only sanctioned way to change a live
//       price could not actually run.
//   B7  The cutover migration's tie-break picks the lowest `priority` rule
//       when two active rules of the same scope_type match one variant,
//       matching the pre-Phase-B engine (`orderBy: { priority: 'asc' }` then
//       first match per scope level). Re-runs the migration's own `matched`/
//       `winners` CTEs over a purpose-built fixture.
'use strict';

const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

let failed = 0;

function record(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

function expectEqual(name, actual, expected) {
  const ok = actual === expected;
  record(name, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function expectUniqueViolation(name, attempt) {
  try {
    await attempt();
    record(name, false, 'expected a unique constraint violation but the write succeeded');
  } catch (error) {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    record(name, isUniqueViolation, isUniqueViolation ? undefined : `unexpected error: ${error?.code ?? ''} ${error?.message ?? error}`);
  }
}

async function countPricingChanges(tenantId, entityKey) {
  return prisma.syncChange.count({
    where: { tenant_id: tenantId, kind: 'pricing', ...(entityKey ? { entity_key: entityKey } : {}) },
  });
}

async function createTenant(label) {
  return prisma.tenant.create({
    data: { name: `${label}-${randomUUID()}`, default_currency: 'EGP' },
  });
}

function bookData(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    name: 'Book',
    currency: 'EGP',
    scope: 'tenant_default',
    scope_ref_id: null,
    status: 'draft',
    is_default: false,
    updated_at: new Date(),
    ...overrides,
  };
}

// --- B1: SyncChange emission ------------------------------------------------

async function verifySyncChangeEmission(tenant) {
  const book = await prisma.priceBook.create({
    data: bookData(tenant.id, { name: 'Sync proof', status: 'active', is_default: true }),
  });

  const before = await countPricingChanges(tenant.id);
  const entry = await prisma.priceBookEntry.create({
    data: {
      tenant_id: tenant.id,
      price_book_id: book.id,
      scope_type: 'global',
      scope_id: null,
      min_qty: 1,
      unit_price: 100,
      tax_percent: 14,
      version: 1,
      status: 'active',
    },
  });
  expectEqual(
    'B1 creating a PriceBookEntry emits a pricing SyncChange',
    await countPricingChanges(tenant.id, entry.id),
    1,
  );
  expectEqual(
    'B1 that SyncChange carries the owning tenant',
    (await prisma.syncChange.findFirst({ where: { entity_key: entry.id } }))?.tenant_id,
    tenant.id,
  );

  // Supersede, in the exact statement order `PriceBookRepository
  // .supersedeEntry` uses: demote the previous row OUT of the
  // `PriceBookEntry_one_active_per_scope_qty` partial unique index first, then
  // insert the successor. Inserting first raises P2002 -- a non-deferrable
  // unique index is checked per statement, not at COMMIT, so being inside one
  // transaction does not save it. (This proof is what caught that; the
  // fakePrisma spec had no index to violate.)
  const successorId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.priceBookEntry.updateMany({
      where: { id: entry.id, status: 'active' },
      data: { status: 'superseded', superseded_by_id: successorId, superseded_at: new Date() },
    });
    await tx.priceBookEntry.create({
      data: {
        id: successorId,
        tenant_id: tenant.id,
        price_book_id: book.id,
        scope_type: 'global',
        scope_id: null,
        min_qty: 1,
        unit_price: 120,
        tax_percent: 14,
        version: 2,
        status: 'active',
      },
    });
  });
  record('B8 supersede succeeds against the real one-active-per-scope index', true);
  expectEqual(
    'B1 superseding an entry emits SyncChange rows for both versions',
    (await countPricingChanges(tenant.id)) - before >= 3,
    true,
  );

  // The invariant behind that ordering constraint, asserted directly.
  await expectUniqueViolation(
    'B8 a SECOND active entry for the same (book, scope, min_qty) is rejected',
    () =>
      prisma.priceBookEntry.create({
        data: {
          tenant_id: tenant.id,
          price_book_id: book.id,
          scope_type: 'global',
          scope_id: null,
          min_qty: 1,
          unit_price: 130,
          tax_percent: 14,
          version: 3,
          status: 'active',
        },
      }),
  );

  // A live-status book transition must reach the terminals...
  const activating = await prisma.priceBook.create({
    data: bookData(tenant.id, { name: 'Lifecycle proof', status: 'scheduled', scope: 'wholesale' }),
  });
  const beforeActivate = await countPricingChanges(tenant.id, activating.id);
  await prisma.priceBook.update({ where: { id: activating.id }, data: { status: 'active' } });
  expectEqual(
    'B1 activating a PriceBook emits a pricing SyncChange',
    (await countPricingChanges(tenant.id, activating.id)) - beforeActivate,
    1,
  );

  // ...but a draft-stage edit must not, since kind='pricing' resets the whole
  // catalog on every terminal.
  const draft = await prisma.priceBook.create({
    data: bookData(tenant.id, { name: 'Draft proof', scope: 'contract' }),
  });
  const beforeRename = await countPricingChanges(tenant.id, draft.id);
  await prisma.priceBook.update({ where: { id: draft.id }, data: { name: 'Draft renamed' } });
  expectEqual(
    'B1 renaming a draft PriceBook emits no SyncChange (no live price changed)',
    (await countPricingChanges(tenant.id, draft.id)) - beforeRename,
    0,
  );
}

// --- B5: the default book can actually be replaced --------------------------

async function verifyDefaultBookReplacement(tenant) {
  const live = await prisma.priceBook.create({
    data: bookData(tenant.id, { name: 'Live default', status: 'active', is_default: true, scope: 'location' }),
  });

  // The whole point: this draft used to be impossible to create.
  const replacement = await prisma.priceBook.create({
    data: bookData(tenant.id, { name: 'Replacement default', status: 'draft', is_default: true, scope: 'location' }),
  });
  record('B5 a replacement default book can be created as a draft alongside the live default', true);

  for (const status of ['submitted', 'approved', 'scheduled']) {
    await prisma.priceBook.update({ where: { id: replacement.id }, data: { status } });
  }
  record('B5 the replacement walks submitted -> approved -> scheduled while still flagged default', true);

  // The swap, exactly as PriceBookService.activate performs it.
  await prisma.$transaction(async (tx) => {
    await tx.priceBook.update({
      where: { id: live.id },
      data: { status: 'ended', is_default: false, ended_at: new Date() },
    });
    await tx.priceBook.update({ where: { id: replacement.id }, data: { status: 'active' } });
  });

  const activeDefaults = await prisma.priceBook.count({
    where: { tenant_id: tenant.id, scope: 'location', is_default: true, status: 'active' },
  });
  expectEqual('B5 after the swap exactly one active default remains (BR-PRB-104)', activeDefaults, 1);

  // The invariant itself is still enforced, not merely relaxed away.
  await expectUniqueViolation(
    'B5 a SECOND active default for the same scope is still rejected by the database',
    () =>
      prisma.priceBook.create({
        data: bookData(tenant.id, { name: 'Second active default', status: 'active', is_default: true, scope: 'location' }),
      }),
  );

  // An ended default keeps its historical flag without blocking anything.
  const endedDefaults = await prisma.priceBook.count({
    where: { tenant_id: tenant.id, scope: 'location', is_default: false, status: 'ended' },
  });
  expectEqual('B5 the outgoing default is ended and demoted', endedDefaults, 1);
}

// --- B7: the migration's tie-break honours PricingRule.priority -------------

/**
 * Re-runs the `matched`/`winners` CTEs from
 * "202608070006_migrate_pricing_rules_to_price_books" verbatim (minus the
 * INSERT) over a fixture where two ACTIVE category-scoped rules match one
 * variant at different priorities. The pre-Phase-B engine ordered rules
 * `priority ASC` and took the first match per scope level, so the lower
 * priority must win; without `priority` in the ORDER BY, `DISTINCT ON`
 * returned whichever row Postgres happened to emit first.
 */
async function verifyMigrationTieBreak(tenant) {
  const category = await prisma.category.create({
    data: { tenant_id: tenant.id, name_ar: 'تصنيف اختبار الأولوية' },
  });
  const product = await prisma.product.create({
    data: { tenant_id: tenant.id, name_en: 'Priority fixture', category_id: category.id, is_active: true },
  });
  const variant = await prisma.productVariant.create({
    data: { tenant_id: tenant.id, product_id: product.id, sku: `PRIO-${randomUUID()}`, cost_price: 100, is_active: true },
  });

  // Same scope_type, same variant, different priority AND different margins.
  await prisma.pricingRule.create({
    data: {
      tenant_id: tenant.id, name: 'Loser (priority 900)', scope_type: 'category', scope_id: category.id,
      overhead_percent: 0, profit_percent: 90, tax_percent: 14, formula: 'compound', priority: 900, is_active: true,
    },
  });
  await prisma.pricingRule.create({
    data: {
      tenant_id: tenant.id, name: 'Winner (priority 10)', scope_type: 'category', scope_id: category.id,
      overhead_percent: 0, profit_percent: 10, tax_percent: 14, formula: 'compound', priority: 10, is_active: true,
    },
  });

  const rows = await prisma.$queryRaw`
    WITH matched AS (
        SELECT
            v."id" AS variant_id,
            v."tenant_id" AS tenant_id,
            v."cost_price" AS cost_price,
            r."overhead_percent" AS overhead_percent,
            r."profit_percent" AS profit_percent,
            r."tax_percent" AS tax_percent,
            r."priority" AS priority,
            r."id" AS rule_id,
            CASE r."scope_type"
                WHEN 'variant' THEN 1
                WHEN 'product' THEN 2
                WHEN 'brand' THEN 3
                WHEN 'category' THEN 4
                WHEN 'global' THEN 5
                ELSE 6
            END AS rank
        FROM "ProductVariant" v
        JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
        JOIN "PricingRule" r ON r."tenant_id" = v."tenant_id" AND r."is_active" = true AND (
            (r."scope_type" = 'variant' AND r."scope_id" = v."id"::text)
            OR (r."scope_type" = 'product' AND r."scope_id" = v."product_id"::text)
            OR (r."scope_type" = 'brand' AND p."brand" IS NOT NULL AND r."scope_id" = p."brand")
            OR (r."scope_type" = 'category' AND p."category_id" IS NOT NULL AND r."scope_id" = p."category_id"::text)
            OR (r."scope_type" = 'global')
        )
        WHERE v."is_active" = true AND p."is_active" = true AND v."id" = ${variant.id}::uuid
    ),
    winners AS (
        SELECT DISTINCT ON (variant_id) variant_id, tenant_id, cost_price, overhead_percent, profit_percent, tax_percent
        FROM matched
        ORDER BY variant_id, rank ASC, priority ASC, rule_id ASC
    )
    SELECT
        ROUND(cost_price * (1 + overhead_percent / 100) * (1 + profit_percent / 100), 2) AS unit_price
    FROM winners
  `;

  expectEqual('B7 exactly one winner is resolved for the fixture variant', rows.length, 1);
  // cost 100, profit 10% -> 110.00. The losing rule would give 190.00.
  expectEqual(
    'B7 the LOWEST-priority-number rule wins a same-scope_type tie (matches the pre-Phase-B engine)',
    rows.length ? Number(rows[0].unit_price) : null,
    110,
  );
}

async function main() {
  const tenant = await createTenant('wp008b-verify');
  await verifySyncChangeEmission(tenant);
  await verifyDefaultBookReplacement(tenant);
  await verifyMigrationTieBreak(tenant);

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll Price Book behaviour checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
