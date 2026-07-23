import { readFileSync } from 'fs';
import { join } from 'path';

describe('transfer state migration contract', () => {
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

  it('creates append-only in-transit accounting', () => {
    expect(migration).toContain('CREATE TABLE "TransferTransitMovement"');
    expect(migration).toContain('"TransferTransitMovement_append_only"');
    expect(migration).toContain('"quantity_delta"');
    expect(migration).toContain('"in_transit_after"');
  });

  it('guards posted transfer documents', () => {
    expect(migration).toContain('"Transfer_protect_posted_document"');
    expect(migration).toContain('"TransferItem_protect_posted_document"');
  });
});
