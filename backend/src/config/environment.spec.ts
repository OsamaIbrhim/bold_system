import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  loadOfflineAccountingConfiguration,
  loadPriceSnapshotConfiguration,
  parseOfflineTicketKeys,
  parsePriceSnapshotKeys,
  validateRuntimeEnvironment,
  validateSecret,
} from './environment';

const jwt = 'jwt-secret-with-sufficient-length-and-character-diversity-01';
const price = 'price-secret-with-sufficient-length-and-character-diversity-02';
const previous = 'previous-price-secret-with-sufficient-character-diversity-03';
const offline = 'offline-ticket-secret-with-sufficient-character-diversity-04';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/bold',
    DIRECT_URL: 'postgresql://user:pass@localhost:5432/bold',
    JWT_SECRET: jwt,
    PRICE_SNAPSHOT_KEYS: `current-2026=${price}`,
    POS_OFFLINE_TICKET_KEYS: `offline-2026=${offline}`,
    CORS_ORIGINS: 'http://localhost:3001,null',
  };
}

function readExampleAssignment(example: string, name: string): string {
  const prefix = `${name}=`;
  const line = example
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  if (!line) {
    throw new Error(`${name} is missing from backend/.env.example`);
  }

  const rawValue = line.slice(prefix.length).trim();
  const isDoubleQuoted = rawValue.startsWith('"') && rawValue.endsWith('"');
  const isSingleQuoted = rawValue.startsWith("'") && rawValue.endsWith("'");

  return isDoubleQuoted || isSingleQuoted
    ? rawValue.slice(1, -1)
    : rawValue;
}

describe('runtime environment validation', () => {
  it('keeps the committed environment example free of usable secrets', () => {
    const example = readFileSync(resolve(__dirname, '../../.env.example'), 'utf8');
    const jwtLine = readExampleAssignment(example, 'JWT_SECRET');
    const priceLine = readExampleAssignment(example, 'PRICE_SNAPSHOT_KEYS');
    const offlineLine = readExampleAssignment(example, 'POS_OFFLINE_TICKET_KEYS');

    expect(jwtLine).toContain('REPLACE_WITH');
    expect(priceLine).toContain('REPLACE_WITH');
    expect(offlineLine).toContain('REPLACE_WITH');
    expect(jwtLine).not.toMatch(/^[a-f0-9]{64}$/i);
    expect(priceLine).not.toMatch(/=[a-f0-9]{64}$/i);
    expect(offlineLine).not.toMatch(/=[a-f0-9]{64}$/i);
  });

  it('accepts separate versioned keyrings for pricing and offline accounting', () => {
    const config = validateRuntimeEnvironment(baseEnv());
    expect(config.priceSnapshots.activeKey.id).toBe('current-2026');
    expect(config.offlineAccounting.activeKey.id).toBe('offline-2026');
    expect(config.offlineAccounting.ttlMs).toBe(86_400_000);
  });

  it('rejects committed placeholders and weak secrets', () => {
    expect(() =>
      validateSecret('JWT_SECRET', 'change-me-use-openssl-rand-hex-32'),
    ).toThrow(/placeholder/);
    expect(() =>
      validateSecret('JWT_SECRET', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).toThrow(/diversity/);
  });

  it('rejects duplicate key ids and duplicate key material', () => {
    expect(() =>
      parsePriceSnapshotKeys(`same=${price},same=${previous}`),
    ).toThrow(/Duplicate/);
    expect(() =>
      parseOfflineTicketKeys(`one=${offline},two=${offline}`),
    ).toThrow(/reuse/);
  });

  it('forbids sharing any JWT, pricing, or offline ticket key material', () => {
    const env = baseEnv();
    env.POS_OFFLINE_TICKET_KEYS = `offline-2026=${price}`;
    expect(() => validateRuntimeEnvironment(env)).toThrow(/must be different/);
  });

  it('validates bounded offline ticket lifetime and clock skew', () => {
    const env = baseEnv();
    env.POS_OFFLINE_TICKET_TTL_MS = '60000';
    expect(() => loadOfflineAccountingConfiguration(env)).toThrow(/between/);
    env.POS_OFFLINE_TICKET_TTL_MS = '86400000';
    env.POS_OFFLINE_CLOCK_SKEW_MS = '900001';
    expect(() => loadOfflineAccountingConfiguration(env)).toThrow(/between/);
  });

  it('requires an explicit, bounded deadline for legacy two-part price tokens', () => {
    const now = Date.parse('2026-07-22T00:00:00.000Z');
    const env = baseEnv();
    env.PRICE_SNAPSHOT_LEGACY_SECRETS = previous;
    expect(() => loadPriceSnapshotConfiguration(env, now)).toThrow(
      /ACCEPT_UNTIL is required/,
    );

    env.PRICE_SNAPSHOT_LEGACY_ACCEPT_UNTIL = '2026-08-10T00:00:00.000Z';
    const config = loadPriceSnapshotConfiguration(env, now);
    expect(config.legacySecrets).toEqual([previous]);
  });

  it('fails explicitly when deprecated price variables remain configured', () => {
    const env = baseEnv();
    env.PRICE_SNAPSHOT_SECRETS = price;
    expect(() => loadPriceSnapshotConfiguration(env)).toThrow(
      /no longer supported/,
    );
  });
});
