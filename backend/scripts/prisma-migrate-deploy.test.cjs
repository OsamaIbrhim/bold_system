'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countMigrationFolders,
  inspectMigrationUrl,
  isAdvisoryLockTimeout,
  listMigrationFolders,
} = require('./prisma-migrate-deploy.cjs');

test('reports the repository migration history used by deployment', () => {
  // WP-008 Phase A added 6 migration folders (147 -> 153) without updating
  // this assertion -- its own "backend" CI job never ran to completion for
  // that PR (cancelled by a runner-availability issue upstream), so nothing
  // caught the staleness until WP-008 Phase B's 6 more migrations made the
  // mismatch visible (159 !== 147).
  assert.equal(countMigrationFolders(), 160);
  assert.deepEqual(listMigrationFolders().slice(-3), [
    '202608070005_add_discount_table',
    '202608070006_migrate_pricing_rules_to_price_books',
    '202608070007_add_price_book_sync_triggers',
  ]);
});

test('accepts direct and session-pooler migration connections', () => {
  assert.deepEqual(
    inspectMigrationUrl(
      'postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require',
    ),
    { connectionKind: 'supabase-direct', port: 5432 },
  );
  assert.deepEqual(
    inspectMigrationUrl(
      'postgresql://postgres.project:secret@region.pooler.supabase.com:5432/postgres?sslmode=require',
    ),
    { connectionKind: 'supabase-session-pooler', port: 5432 },
  );
});

test('rejects the transaction pooler for migrations', () => {
  assert.throws(
    () =>
      inspectMigrationUrl(
        'postgresql://postgres.project:secret@region.pooler.supabase.com:6543/postgres?pgbouncer=true',
      ),
    /transaction pooler/,
  );
});

test('retries only Prisma advisory-lock P1002 failures', () => {
  assert.equal(
    isAdvisoryLockTimeout(
      'Error: P1002\nSELECT pg_advisory_lock(72707369)',
    ),
    true,
  );
  assert.equal(isAdvisoryLockTimeout('Error: P1001'), false);
  assert.equal(isAdvisoryLockTimeout('Error: P1002 network timeout'), false);
});
