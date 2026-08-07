'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runPreCheck, runPostCheck } = require('./validate-pricing-rule-migration.cjs');

function noopLog() {}

test('runPreCheck reports variant/product-scoped rows as directly migratable', async () => {
  const runQuery = async (sql) => {
    if (sql.includes(`"is_active" = true`) && sql.includes('count(*)::int AS count') && !sql.includes('GROUP BY')) {
      return [{ count: 2 }];
    }
    if (sql.includes(`"is_active" = false`)) return [{ count: 0 }];
    if (sql.includes("IN ('variant', 'product')")) {
      return [
        { scope_type: 'variant', count: 1 },
        { scope_type: 'product', count: 1 },
      ];
    }
    if (sql.includes("IN ('brand', 'category', 'global')")) return [];
    return [];
  };
  const result = await runPreCheck(runQuery, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.totalActive, 2);
  assert.equal(result.ambiguousTotal, 0);
  assert.deepEqual(
    result.directlyMigratable.map((r) => r.scope_type).sort(),
    ['product', 'variant'],
  );
});

test('runPreCheck reports brand/category/global-scoped rows as ambiguous, never as a failure', async () => {
  const runQuery = async (sql) => {
    if (sql.includes(`"is_active" = true`) && sql.includes('count(*)::int AS count') && !sql.includes('GROUP BY')) {
      return [{ count: 3 }];
    }
    if (sql.includes(`"is_active" = false`)) return [{ count: 5 }];
    if (sql.includes("IN ('variant', 'product')")) return [];
    if (sql.includes("IN ('brand', 'category', 'global')")) {
      return [
        { scope_type: 'category', count: 2 },
        { scope_type: 'global', count: 1 },
      ];
    }
    return [];
  };
  const result = await runPreCheck(runQuery, noopLog);
  // Ambiguous data is reported, never silently dropped and never a hard
  // failure -- the migration still prices every live variant correctly.
  assert.equal(result.ok, true);
  assert.equal(result.totalInactive, 5);
  assert.equal(result.ambiguousTotal, 3);
  assert.deepEqual(
    result.ambiguous.map((r) => r.scope_type).sort(),
    ['category', 'global'],
  );
});

test('runPostCheck passes when every live variant has exactly one migrated entry', async () => {
  const runQuery = async () => [{ count: 10 }];
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.liveVariants, 10);
  assert.equal(result.migratedEntries, 10);
});

test('runPostCheck fails loud (not a silent pass) when live variants and migrated entries diverge', async () => {
  let call = 0;
  const runQuery = async () => {
    call += 1;
    return call === 1 ? [{ count: 10 }] : [{ count: 7 }];
  };
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.equal(result.liveVariants, 10);
  assert.equal(result.migratedEntries, 7);
});

// B6: the accounting above is worthless if nothing runs it. The migration's
// own `RAISE NOTICE` never surfaces (`prisma migrate deploy` does not print
// PostgreSQL NOTICE messages, and nothing captured them), which made
// CLAUDE.md §6 "fail loud on ambiguous data" fail *silently* instead. These
// assertions pin the CI wiring so it cannot be dropped without a red test.
// Line endings normalised: the repository checks this file out with CRLF on
// Windows, and these assertions are about content, not about newline style.
const workflow = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8').split('\r\n').join('\n');
const migrationGate = workflow.slice(
  workflow.indexOf('\n  migration-gate:'),
  workflow.indexOf('\n  admin:'),
);

test('the migration-gate CI job runs the pre-migration ambiguous-row report', () => {
  assert.ok(migrationGate.includes('node scripts/validate-pricing-rule-migration.cjs\n'));
});

test('the migration-gate CI job runs the post-migration 1:1 invariant check', () => {
  assert.ok(migrationGate.includes('node scripts/validate-pricing-rule-migration.cjs --post-check'));
});

test('the pre-check runs BEFORE the migrations it is accounting for, the post-check after', () => {
  const preCheck = migrationGate.indexOf('node scripts/validate-pricing-rule-migration.cjs\n');
  const deploy = migrationGate.indexOf('npx prisma migrate deploy', preCheck);
  const postCheck = migrationGate.indexOf('node scripts/validate-pricing-rule-migration.cjs --post-check');
  assert.ok(preCheck > -1 && deploy > preCheck && postCheck > deploy);
});

test('the migration-gate CI job runs the Price Book database-behaviour proof', () => {
  assert.ok(migrationGate.includes('node scripts/verify-price-book-behaviour.cjs'));
});

test('runPostCheck exits non-zero -- a wired check that cannot fail the build proves nothing', async () => {
  // Mirrors what `main()` does with the result: `ok: false` => process.exitCode = 1.
  const runQuery = async () => (call++ === 0 ? [{ count: 4 }] : [{ count: 1 }]);
  let call = 0;
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.notEqual(result.liveVariants, result.migratedEntries);
});

// B7: the tie-break that keeps live prices from drifting on cutover lives in
// the migration SQL itself. `verify-price-book-behaviour.cjs` proves the
// *semantics* against real Postgres, but it re-runs a copy of the CTEs, so it
// would still pass if the migration were edited. This assertion pins the
// migration file: the old engine ordered rules `priority ASC` and took the
// first match per scope level, so `DISTINCT ON` must break a same-scope_type
// tie the same way instead of taking an arbitrary row.
test('the cutover migration breaks same-scope ties by PricingRule.priority', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', '202608070006_migrate_pricing_rules_to_price_books', 'migration.sql'),
    'utf8',
  );
  const winners = sql.slice(sql.indexOf('winners AS ('), sql.indexOf('unmatched AS ('));
  assert.match(winners, /ORDER BY[^\n]*rank ASC[^\n]*priority ASC/);
  assert.match(sql.slice(sql.indexOf('matched AS ('), sql.indexOf('winners AS (')), /r\."priority" AS priority/);
});
