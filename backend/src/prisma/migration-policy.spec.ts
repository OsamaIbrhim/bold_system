const {
  evaluateMigrationChanges,
  parseGitChanges,
  sha256,
} = require('../../scripts/check-migration-policy.cjs');

describe('migration release policy', () => {
  const migrationPath =
    'prisma/migrations/202607230002_transfer_state_machine/migration.sql';

  it('allows a new forward-only migration', () => {
    const result = evaluateMigrationChanges({
      changes: [{ status: 'A', path: migrationPath }],
      repairs: [],
      readBaseFile: () => {
        throw new Error('base content should not be read for a new migration');
      },
      readCurrentFile: () => 'CREATE TABLE "SafeMigration" ("id" UUID);',
    });

    expect(result.errors).toEqual([]);
    expect(result.addedMigrations).toEqual([
      '202607230002_transfer_state_machine',
    ]);
  });

  it('rejects edits to an existing migration by default', () => {
    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: migrationPath }],
      repairs: [],
      readBaseFile: () => 'old SQL',
      readCurrentFile: () => 'new SQL',
    });

    expect(result.errors).toEqual([
      expect.stringContaining('Applied migration cannot be edited'),
    ]);
  });

  it('allows only the exact documented incident repair pair', () => {
    const base = 'broken SQL';
    const repaired = 'resumable SQL';
    const repairs = [
      {
        migration: '202607230002_transfer_state_machine',
        baseSha256: sha256(base),
        repairedSha256: sha256(repaired),
        upgradeFromRef: '156d237',
        incident: 'P3018 incident recovery',
      },
    ];
    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: migrationPath }],
      repairs,
      readBaseFile: () => base,
      readCurrentFile: () => repaired,
    });

    expect(result.errors).toEqual([]);
    expect(result.upgradeFromRef).toBe('156d237');
    expect(result.approvedRepairs).toHaveLength(1);
  });

  it('rejects any later edit even when the migration has a repair record', () => {
    const base = 'resumable SQL';
    const repairs = [
      {
        migration: '202607230002_transfer_state_machine',
        baseSha256: sha256('broken SQL'),
        repairedSha256: sha256(base),
        upgradeFromRef: '156d237',
        incident: 'P3018 incident recovery',
      },
    ];
    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: migrationPath }],
      repairs,
      readBaseFile: () => base,
      readCurrentFile: () => 'a second unauthorized edit',
    });

    expect(result.errors).toEqual([
      expect.stringContaining('Applied migration cannot be edited'),
    ]);
  });

  it('requires a migration when the Prisma schema changes', () => {
    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: 'prisma/schema.prisma' }],
      repairs: [],
      readBaseFile: () => '',
      readCurrentFile: () => '',
    });

    expect(result.errors).toEqual([
      expect.stringContaining('changed without a new migration'),
    ]);
  });

  it('keeps the incident repair manifest immutable after release', () => {
    const policyScript = require('fs').readFileSync(
      require('path').join(
        process.cwd(),
        'scripts/check-migration-policy.cjs',
      ),
      'utf8',
    );

    expect(policyScript).toContain(
      'prisma/migration-repairs.json is immutable',
    );
    expect(policyScript).toContain('INITIAL_REPAIR_MANIFEST_SHA256');
  });

  it('parses null-delimited git changes without path ambiguity', () => {
    expect(
      parseGitChanges(
        `A\0${migrationPath}\0M\0prisma/schema.prisma\0`,
      ),
    ).toEqual([
      { status: 'A', path: migrationPath },
      { status: 'M', path: 'prisma/schema.prisma' },
    ]);
  });
});
