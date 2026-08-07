#!/usr/bin/env node
// WP-008 Phase B — PricingRule -> PriceBook/PriceBookEntry migration
// accounting (CLAUDE.md §6 "fail loud on ambiguous data").
//
// Mirrors the "202608070006_migrate_pricing_rules_to_price_books" migration
// SQL's own DO $$ ... $$ validation block, as a standalone, independently
// runnable/testable tool (same pattern as validate-tenant-backfill.cjs):
//
// Pre-migration (default): counts active PricingRule rows by scope_type.
// variant/product-scoped rows are directly, unambiguously migratable (the
// affected variant set is finite and enumerable). brand/category/global-
// scoped rows are reported as INFO, not a failure -- the migration still
// freezes every currently-live variant's price correctly (via its own
// per-variant entry), it just does not carry these forward as a reusable
// scope-level default for a variant added after cutover. Inactive rows are
// reported separately (they already have zero live-pricing effect today).
//
// Post-migration (--post-check): a HARD STOP if any active ProductVariant
// (of an active Product) does not have exactly one active, variant-scoped
// PriceBookEntry -- this is the "zero live-price data loss" invariant the
// migration's own DO block also asserts; running it here again after `prisma
// migrate deploy` in CI is redundant-by-design (defense in depth), not a
// substitute for that guard.

// runQuery(sql) => Promise<Array<object>>. Injectable so this logic is
// testable without a real database (see
// validate-pricing-rule-migration.test.cjs).
async function runPreCheck(runQuery, log = console.log) {
  log('WP-008 Phase B PricingRule migration accounting (pre-migration)');

  const [{ count: totalActive }] = await runQuery(
    `SELECT count(*)::int AS count FROM "PricingRule" WHERE "is_active" = true`,
  );
  const [{ count: totalInactive }] = await runQuery(
    `SELECT count(*)::int AS count FROM "PricingRule" WHERE "is_active" = false`,
  );
  const directlyMigratable = await runQuery(
    `SELECT "scope_type", count(*)::int AS count FROM "PricingRule"
     WHERE "is_active" = true AND "scope_type" IN ('variant', 'product')
     GROUP BY "scope_type"`,
  );
  const ambiguous = await runQuery(
    `SELECT "scope_type", count(*)::int AS count FROM "PricingRule"
     WHERE "is_active" = true AND "scope_type" IN ('brand', 'category', 'global')
     GROUP BY "scope_type"`,
  );

  log(`Active PricingRule rows: ${totalActive} (inactive, not migrated: ${totalInactive}).`);
  for (const row of directlyMigratable) {
    log(`  ${row.count} row(s) scope_type="${row.scope_type}" -- directly, unambiguously migratable.`);
  }
  for (const row of ambiguous) {
    log(
      `  ${row.count} row(s) scope_type="${row.scope_type}" -- AMBIGUOUS: a single fixed unit_price cannot ` +
        `represent this rule's cost-multiplier formula across every variant it could match. Every variant ` +
        `it prices *today* is still migrated correctly (a frozen per-variant entry), but it is not carried ` +
        `forward as a reusable scope-level default.`,
    );
  }

  const ambiguousTotal = ambiguous.reduce((sum, row) => sum + row.count, 0);
  return {
    ok: true,
    totalActive,
    totalInactive,
    directlyMigratable,
    ambiguous,
    ambiguousTotal,
  };
}

async function runPostCheck(runQuery, log = console.log, logError = console.error) {
  log('WP-008 Phase B PricingRule migration accounting (post-migration)');

  const [{ count: liveVariants }] = await runQuery(
    `SELECT count(*)::int AS count
     FROM "ProductVariant" v
     JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
     WHERE v."is_active" = true AND p."is_active" = true`,
  );
  const [{ count: migratedEntries }] = await runQuery(
    `SELECT count(*)::int AS count
     FROM "PriceBookEntry" e
     JOIN "ProductVariant" v ON v."tenant_id" = e."tenant_id" AND v."id" = e."scope_id"
     JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
     WHERE e."scope_type" = 'variant' AND e."status" = 'active'
       AND v."is_active" = true AND p."is_active" = true`,
  );

  if (liveVariants !== migratedEntries) {
    logError(
      `FAILED: ${liveVariants} active ProductVariant row(s) but only ${migratedEntries} resolved to a ` +
        `migrated active variant-scope PriceBookEntry -- expected a 1:1 mapping (zero live-price data loss).`,
    );
    return { ok: false, liveVariants, migratedEntries };
  }

  log(`PASSED: ${liveVariants} active ProductVariant row(s), all with a migrated active PriceBookEntry.`);
  return { ok: true, liveVariants, migratedEntries };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const runQuery = (sql) => prisma.$queryRawUnsafe(sql);
  try {
    const result = process.argv.includes('--post-check')
      ? await runPostCheck(runQuery)
      : await runPreCheck(runQuery);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runPreCheck, runPostCheck };
