import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('migration CI database isolation', () => {
  const workflow = readFileSync(
    resolve(process.cwd(), '../.github/workflows/ci.yml'),
    'utf8',
  );

  it('uses a separate PostgreSQL database for each migration target and shadow', () => {
    const databaseNames = [
      'bold_migrations_clean',
      'bold_migrations_clean_shadow',
      'bold_migrations_upgrade',
      'bold_migrations_upgrade_shadow',
    ];

    for (const databaseName of databaseNames) {
      const occurrences = workflow.match(new RegExp(databaseName, 'g')) ?? [];

      expect(occurrences.length).toBeGreaterThanOrEqual(2);
      expect(workflow).toContain(`localhost:5432/${databaseName}`);
    }

    expect(new Set(databaseNames).size).toBe(databaseNames.length);
    expect(workflow).toContain('createdb');
    expect(workflow).not.toMatch(/bold_migrations\?schema=/);
  });
});
