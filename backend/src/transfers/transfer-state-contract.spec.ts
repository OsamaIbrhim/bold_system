import { readFileSync } from 'fs';
import { join } from 'path';

describe('transfer state migration contract', () => {
  const earlierMigration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260719130000_transfer_integrity/migration.sql',
    ),
    'utf8',
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/202607230002_transfer_state_machine/migration.sql',
    ),
    'utf8',
  );

  it('adds partial receipt and explicit transit quantities', () => {
    expect(migration).toContain("'partially_received'");
    expect(migration).toContain('"shipped_qty"');
    expect(migration).toContain('"received_qty"');
    expect(migration).toContain('"damaged_qty"');
    expect(migration).toContain('"missing_qty"');
  });

  it('replaces the legacy transfer-level inventory trigger', () => {
    expect(migration).toContain(
      'DROP TRIGGER IF EXISTS "Transfer_inventory_movement"',
    );
    expect(migration).toContain(
      '"TransferItem_inventory_and_transit_movements"',
    );
  });

  it('drops the deferred legacy trigger before backfilling transfers', () => {
    const dropLegacyTrigger = migration.indexOf(
      'DROP TRIGGER IF EXISTS "Transfer_inventory_movement"',
    );
    const transferBackfill = migration.search(/UPDATE "Transfer"\r?\nSET/);
    const firstTransferConstraint = migration.indexOf(
      'ADD CONSTRAINT "Transfer_distinct_branches"',
    );

    expect(dropLegacyTrigger).toBeGreaterThan(-1);
    expect(transferBackfill).toBeGreaterThan(dropLegacyTrigger);
    expect(firstTransferConstraint).toBeGreaterThan(transferBackfill);
  });

  it('creates append-only in-transit accounting', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "TransferTransitMovement"',
    );
    expect(migration).toContain('"TransferTransitMovement_append_only"');
    expect(migration).toContain('"quantity_delta"');
    expect(migration).toContain('"in_transit_after"');
  });

  it('guards posted transfer documents', () => {
    expect(migration).toContain('"Transfer_protect_posted_document"');
    expect(migration).toContain('"TransferItem_protect_posted_document"');
  });

  it('does not recreate the legacy positive-quantity constraint', () => {
    expect(earlierMigration).toContain(
      'ADD CONSTRAINT "TransferItem_qty_positive"',
    );
    expect(migration).not.toContain(
      'ADD CONSTRAINT "TransferItem_qty_positive"',
    );
  });

  it('can resume after PostgreSQL committed its initial DDL', () => {
    expect(migration).toContain('WHEN duplicate_object THEN NULL');
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "idempotency_key"',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "TransferTransitMovement"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "TransferItem_transfer_id_variant_id_key"',
    );
    expect(migration).toContain(
      'ON CONFLICT ("idempotency_key") DO NOTHING',
    );
  });

  it('keeps the hard smoke command cross-platform', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    const hardLoad = readFileSync(
      join(process.cwd(), 'perf/hard-load.mjs'),
      'utf8',
    );

    expect(packageJson.scripts['test:hard:smoke']).toContain(
      'run-hard-suite.mjs --smoke',
    );
    expect(packageJson.scripts['test:hard:smoke']).not.toContain(
      'PERF_SMOKE=1',
    );
    expect(hardLoad).toContain("process.argv.includes('--smoke')");
  });

  it('guards the destructive accounting reset from production and accidents', () => {
    const resetScript = readFileSync(
      join(process.cwd(), 'prisma/reset-development-accounting.ts'),
      'utf8',
    );

    expect(resetScript).toContain("process.env.NODE_ENV === 'production'");
    expect(resetScript).toContain(
      'ALLOW_DEVELOPMENT_ACCOUNTING_RESET',
    );
    expect(resetScript).toContain(
      'ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET',
    );
    expect(resetScript).toContain('maxWait: 15_000');
    expect(resetScript).toContain('timeout: 120_000');
    expect(resetScript.indexOf('assertDevelopmentResetAllowed();')).toBeLessThan(
      resetScript.indexOf('prisma.$transaction'),
    );
  });
});
