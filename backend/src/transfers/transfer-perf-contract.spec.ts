import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('transfer performance fixture contract', () => {
  const perfDirectory = join(process.cwd(), 'perf');
  const helperModule = './support/transfer-command-context.mjs';
  const helperCall = 'await enableTransferCommandContext(tx)';
  const protectedTransferMutation =
    /(?:\b(?:tx|prisma)\.transfer\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"Transfer")/i;
  const manualCustodyMutation =
    /UPDATE\s+"TransferItem"\s+SET\s+"(?:shipped_qty|received_qty|damaged_qty|missing_qty)"/i;
  const manualPrismaStateMutation =
    /\.transfer\.update\s*\(\s*\{[\s\S]*?status\s*:\s*['"](?:shipped|received|partially_received)['"]/i;
  const manualSqlStateMutation =
    /UPDATE\s+"Transfer"\s+SET[\s\S]*?"status"\s*=\s*['"](?:shipped|received|partially_received)['"]/i;

  const findPerformanceScripts = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return entry.name === 'support' ? [] : findPerformanceScripts(path);
      }
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

      expect({ path, importsSharedHelper: source.includes(helperModule) }).toEqual({
        path,
        importsSharedHelper: true,
      });
      expect(contextCall).toBeGreaterThanOrEqual(0);
      expect(contextCall).toBeLessThan(firstMutation);
      expect(source).not.toContain(
        "set_config('bold.transfer_command', 'on', true)",
      );
    }
  });

  it('centralizes protected transfer lifecycle ordering in the fixture helper', () => {
    const lifecycleScripts = performanceScripts
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => source.includes('markTransferFixtureShipped'));

    expect(lifecycleScripts.length).toBeGreaterThan(0);

    for (const { path, source } of lifecycleScripts) {
      expect({ path, receivesThroughHelper: source }).toEqual({
        path,
        receivesThroughHelper: expect.stringContaining(
          'resolveTransferFixtureReceipt',
        ),
      });
      expect({ path, manualCustody: manualCustodyMutation.test(source) }).toEqual({
        path,
        manualCustody: false,
      });
      expect({
        path,
        manualState:
          manualPrismaStateMutation.test(source) ||
          manualSqlStateMutation.test(source),
      }).toEqual({ path, manualState: false });
    }
  });

  it('keeps the command-context and lifecycle implementation centralized', () => {
    const helper = readFileSync(
      join(perfDirectory, 'support/transfer-command-context.mjs'),
      'utf8',
    );

    expect(helper).toContain(
      "set_config('bold.transfer_command', 'on', true)",
    );
    expect(helper).toContain('requires a Prisma transaction client');
    expect(helper).toContain('export async function markTransferFixtureShipped');
    expect(helper).toContain('export async function resolveTransferFixtureReceipt');
    expect(helper.indexOf('SET "shipped_qty" = "qty"')).toBeLessThan(
      helper.indexOf(`SET "status" = 'shipped'`),
    );
    expect(helper.indexOf('SET "received_qty" = "received_qty"')).toBeLessThan(
      helper.indexOf('SET "status" = ${status}'),
    );
  });

  it('verifies transfer ledger entries by stable reference identity', () => {
    const inventoryLedgerSmoke = readFileSync(
      join(perfDirectory, 'inventory-ledger-smoke.mjs'),
      'utf8',
    );

    expect(inventoryLedgerSmoke).toContain(
      'async function findSingleTransferMovement',
    );
    expect(inventoryLedgerSmoke).toContain("reference_type: 'Transfer'");
    expect(inventoryLedgerSmoke).toContain('reference_id: transferId');
    expect(inventoryLedgerSmoke).toContain(
      'reference_line_id: transferItemId',
    );
    expect(inventoryLedgerSmoke).toContain("movementType: 'transfer_out'");
    expect(inventoryLedgerSmoke).toContain("movementType: 'transfer_in'");
    expect(inventoryLedgerSmoke).not.toMatch(
      /idempotency_key:\s*`transfer-(?:out|in):/,
    );
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
