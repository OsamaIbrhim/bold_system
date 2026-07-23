import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('transfer performance fixture contract', () => {
  const perfDirectory = join(process.cwd(), 'perf');
  const helperImport =
    "import { enableTransferCommandContext } from './support/transfer-command-context.mjs'";
  const helperCall = 'await enableTransferCommandContext(tx)';
  const protectedTransferMutation =
    /(?:\b(?:tx|prisma)\.transfer\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"Transfer")/i;

  const findPerformanceScripts = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) return findPerformanceScripts(path);
      return entry.isFile() && entry.name.endsWith('.mjs') ? [path] : [];
    });

  const performanceScripts = findPerformanceScripts(perfDirectory);

  it('enables transaction-local command context before every direct transfer mutation', () => {
    const mutatingScripts = performanceScripts
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => protectedTransferMutation.test(source));

    expect(mutatingScripts.length).toBeGreaterThan(0);

    for (const { path, source } of mutatingScripts) {
      const firstMutation = source.search(protectedTransferMutation);
      const contextCall = source.indexOf(helperCall);

      expect({ path, importsSharedHelper: source.includes(helperImport) }).toEqual({
        path,
        importsSharedHelper: true,
      });
      expect({ path, contextCall }).toEqual({
        path,
        contextCall: expect.any(Number),
      });
      expect(contextCall).toBeGreaterThanOrEqual(0);
      expect(contextCall).toBeLessThan(firstMutation);
      expect(source).not.toContain(
        "set_config('bold.transfer_command', 'on', true)",
      );
    }
  });

  it('keeps the command-context implementation centralized and transaction-local', () => {
    const helper = readFileSync(
      join(perfDirectory, 'support/transfer-command-context.mjs'),
      'utf8',
    );

    expect(helper).toContain(
      "set_config('bold.transfer_command', 'on', true)",
    );
    expect(helper).toContain('requires a Prisma transaction client');
  });

  it('runs every hard suite and reports all failures in one pass', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    const runner = readFileSync(
      join(perfDirectory, 'run-hard-suite.mjs'),
      'utf8',
    );
    const expectedScripts = [
      'perf/hard-load.mjs',
      'perf/inventory-ledger-smoke.mjs',
      'perf/purchasing-accounting-smoke.mjs',
      'perf/transfer-state-smoke.mjs',
    ];

    expect(packageJson.scripts['test:hard']).toBe(
      'node perf/run-hard-suite.mjs',
    );
    expect(packageJson.scripts['test:hard:smoke']).toBe(
      'node perf/run-hard-suite.mjs --smoke',
    );
    for (const script of expectedScripts) {
      expect(runner).toContain(`script: '${script}'`);
    }
    expect(runner).toContain('for (const suite of suites)');
    expect(runner).toContain("type: 'hard_suite_summary'");
    expect(runner).toContain('if (failed.length > 0) process.exitCode = 1');
  });
});
