import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('migration CI database isolation', () => {
  const workflow = readFileSync(
    resolve(process.cwd(), '../.github/workflows/ci.yml'),
    'utf8',
  );

  const getJob = (jobName: string): string => {
    const jobStart = workflow.search(new RegExp(`^  ${jobName}:\\r?$`, 'm'));

    expect(jobStart).toBeGreaterThanOrEqual(0);

    const remainingJobs = workflow.slice(jobStart + 1);
    const nextJob = remainingJobs.search(/^  [a-z0-9-]+:\r?$/m);

    return nextJob === -1
      ? workflow.slice(jobStart)
      : workflow.slice(jobStart, jobStart + 1 + nextJob);
  };

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

  it('authorizes destructive reset only in local seeded CI jobs', () => {
    for (const jobName of ['hard-smoke', 'hard-load']) {
      const job = getJob(jobName);

      expect(job).toContain(
        'DATABASE_URL: postgresql://postgres:postgres@localhost:5432/bold_perf',
      );
      expect(job).toContain('npm run prisma:seed');
      expect(job).toContain(
        'ALLOW_DEVELOPMENT_ACCOUNTING_RESET: reset-development-accounting',
      );
      expect(job).not.toContain('ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET');
      expect(job).toContain('PERF_LOGIN_PHONE: "+200100000000"');
    }

    expect(getJob('hard-load')).toContain(
      'PERF_CASHIER_PHONE: "+200100000002"',
    );
    expect(workflow).not.toMatch(/PERF_(?:LOGIN|CASHIER)_PHONE:\s+\+\d/);
  });
});
