export type VersionedSecretKey = {
  id: string;
  secret: string;
};

/**
 * Domain aliases keep cryptographic call sites explicit while all versioned
 * keyrings continue to share one validated representation.
 */
export type PriceSnapshotKey = VersionedSecretKey;
export type OfflineAccountingKey = VersionedSecretKey;

export type PriceSnapshotConfiguration = {
  activeKey: PriceSnapshotKey;
  keys: PriceSnapshotKey[];
  keysById: Map<string, PriceSnapshotKey>;
  legacySecrets: string[];
  legacyAcceptUntilMs: number | null;
};

export type OfflineAccountingConfiguration = {
  activeKey: OfflineAccountingKey;
  keys: OfflineAccountingKey[];
  keysById: Map<string, OfflineAccountingKey>;
  ttlMs: number;
  clockSkewMs: number;
};

export type RuntimeEnvironment = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  directUrl: string;
  jwtSecret: string;
  jwtExpires: string;
  refreshExpires: string;
  port: number;
  corsOrigins: string[];
  priceSnapshots: PriceSnapshotConfiguration;
  offlineAccounting: OfflineAccountingConfiguration;
};

const SECRET_PLACEHOLDER = /(?:change[-_ ]?me|replace[-_ ]?me|placeholder|example[-_ ]?secret|generate[-_ ]?with|your[-_ ]?(?:secret|key)|secret[-_ ]?here|<|>)/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
const DURATION = /^\d+[mhd]$/;
const MAX_ACTIVE_KEYS = 3;
const MAX_LEGACY_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MIN_OFFLINE_TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_OFFLINE_TICKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CLOCK_SKEW_MS = 0;
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

function required(name: string, value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} must be configured`);
  return normalized;
}

export function validateSecret(name: string, value: string | undefined) {
  const secret = required(name, value);
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  if (SECRET_PLACEHOLDER.test(secret)) {
    throw new Error(`${name} contains a placeholder and must be replaced`);
  }
  if (new Set(secret).size < 10) {
    throw new Error(`${name} does not contain enough character diversity`);
  }
  return secret;
}

function parseVersionedKeyEntry(
  variableName: string,
  entry: string,
  index: number,
): VersionedSecretKey {
  const separator = entry.indexOf('=');
  if (separator <= 0 || separator === entry.length - 1) {
    throw new Error(
      `${variableName} entry ${index + 1} must use key_id=secret`,
    );
  }
  const id = entry.slice(0, separator).trim();
  const secret = entry.slice(separator + 1).trim();
  if (!KEY_ID.test(id)) {
    throw new Error(
      `${variableName} key id "${id}" must be 3-32 letters, digits, underscores, or hyphens`,
    );
  }
  return {
    id,
    secret: validateSecret(`${variableName}[${id}]`, secret),
  };
}

export function parseVersionedSecretKeys(
  variableName: string,
  value: string | undefined,
) {
  const raw = required(variableName, value);
  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) {
    throw new Error(`${variableName} must contain at least one key`);
  }
  if (entries.length > MAX_ACTIVE_KEYS) {
    throw new Error(
      `${variableName} supports at most ${MAX_ACTIVE_KEYS} active/previous keys`,
    );
  }

  const keys = entries.map((entry, index) =>
    parseVersionedKeyEntry(variableName, entry, index),
  );
  const ids = new Set<string>();
  const secrets = new Set<string>();
  for (const key of keys) {
    if (ids.has(key.id)) {
      throw new Error(`Duplicate ${variableName} key id: ${key.id}`);
    }
    if (secrets.has(key.secret)) {
      throw new Error(
        `${variableName} must not reuse the same secret under multiple key ids`,
      );
    }
    ids.add(key.id);
    secrets.add(key.secret);
  }
  return keys;
}

export function parsePriceSnapshotKeys(value: string | undefined) {
  return parseVersionedSecretKeys('PRICE_SNAPSHOT_KEYS', value);
}

export function parseOfflineTicketKeys(value: string | undefined) {
  return parseVersionedSecretKeys('POS_OFFLINE_TICKET_KEYS', value);
}

function parseLegacySecrets(value: string | undefined) {
  const secrets = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((secret, index) =>
      validateSecret(`PRICE_SNAPSHOT_LEGACY_SECRETS[${index}]`, secret),
    );
  if (new Set(secrets).size !== secrets.length) {
    throw new Error('PRICE_SNAPSHOT_LEGACY_SECRETS contains duplicate secrets');
  }
  return secrets;
}

function parseLegacyDeadline(
  legacySecrets: string[],
  value: string | undefined,
  nowMs: number,
) {
  const raw = String(value || '').trim();
  if (!legacySecrets.length) {
    if (raw) {
      throw new Error(
        'PRICE_SNAPSHOT_LEGACY_ACCEPT_UNTIL must be empty when no legacy secrets are configured',
      );
    }
    return null;
  }
  if (!raw) {
    throw new Error(
      'PRICE_SNAPSHOT_LEGACY_ACCEPT_UNTIL is required when legacy price secrets are configured',
    );
  }
  const deadline = Date.parse(raw);
  if (!Number.isFinite(deadline)) {
    throw new Error(
      'PRICE_SNAPSHOT_LEGACY_ACCEPT_UNTIL must be a valid ISO-8601 timestamp',
    );
  }
  if (deadline <= nowMs) {
    throw new Error(
      'PRICE_SNAPSHOT_LEGACY_ACCEPT_UNTIL has expired; remove the legacy secrets after reconciling pending sales',
    );
  }
  if (deadline - nowMs > MAX_LEGACY_WINDOW_MS) {
    throw new Error('Legacy price snapshot acceptance cannot exceed 31 days');
  }
  return deadline;
}

export function loadPriceSnapshotConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): PriceSnapshotConfiguration {
  if (env.PRICE_SNAPSHOT_SECRETS || env.PRICE_SNAPSHOT_SECRET) {
    throw new Error(
      'PRICE_SNAPSHOT_SECRETS and PRICE_SNAPSHOT_SECRET are no longer supported. Configure PRICE_SNAPSHOT_KEYS using key_id=secret.',
    );
  }

  const keys = parsePriceSnapshotKeys(env.PRICE_SNAPSHOT_KEYS);
  const legacySecrets = parseLegacySecrets(env.PRICE_SNAPSHOT_LEGACY_SECRETS);
  const legacyAcceptUntilMs = parseLegacyDeadline(
    legacySecrets,
    env.PRICE_SNAPSHOT_LEGACY_ACCEPT_UNTIL,
    nowMs,
  );

  const activeSecrets = new Set(keys.map((key) => key.secret));
  if (legacySecrets.some((secret) => activeSecrets.has(secret))) {
    throw new Error('Legacy price secrets must not duplicate an active key');
  }

  return {
    activeKey: keys[0],
    keys,
    keysById: new Map(keys.map((key) => [key.id, key])),
    legacySecrets,
    legacyAcceptUntilMs,
  };
}

function parseIntegerRange(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function loadOfflineAccountingConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): OfflineAccountingConfiguration {
  const keys = parseOfflineTicketKeys(env.POS_OFFLINE_TICKET_KEYS);
  return {
    activeKey: keys[0],
    keys,
    keysById: new Map(keys.map((key) => [key.id, key])),
    ttlMs: parseIntegerRange(
      'POS_OFFLINE_TICKET_TTL_MS',
      env.POS_OFFLINE_TICKET_TTL_MS,
      24 * 60 * 60 * 1000,
      MIN_OFFLINE_TICKET_TTL_MS,
      MAX_OFFLINE_TICKET_TTL_MS,
    ),
    clockSkewMs: parseIntegerRange(
      'POS_OFFLINE_CLOCK_SKEW_MS',
      env.POS_OFFLINE_CLOCK_SKEW_MS,
      5 * 60 * 1000,
      MIN_CLOCK_SKEW_MS,
      MAX_CLOCK_SKEW_MS,
    ),
  };
}

function parsePort(value: string | undefined) {
  const port = Number(value || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseDuration(name: string, value: string | undefined, fallback: string) {
  const duration = String(value || fallback).trim();
  if (!DURATION.test(duration)) {
    throw new Error(`${name} must use an integer followed by m, h, or d`);
  }
  return duration;
}

function parseNodeEnv(value: string | undefined): RuntimeEnvironment['nodeEnv'] {
  const nodeEnv = String(value || 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  return nodeEnv as RuntimeEnvironment['nodeEnv'];
}

function parseCorsOrigins(value: string | undefined) {
  const origins = String(value || 'null')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!origins.length) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGINS must not contain a wildcard');
  }
  return origins;
}

export function validateRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): RuntimeEnvironment {
  const jwtSecret = validateSecret('JWT_SECRET', env.JWT_SECRET);
  const priceSnapshots = loadPriceSnapshotConfiguration(env, nowMs);
  const offlineAccounting = loadOfflineAccountingConfiguration(env);
  const namedSecrets = [
    { name: 'JWT_SECRET', secret: jwtSecret },
    ...priceSnapshots.keys.map((key) => ({
      name: `PRICE_SNAPSHOT_KEYS[${key.id}]`,
      secret: key.secret,
    })),
    ...priceSnapshots.legacySecrets.map((secret, index) => ({
      name: `PRICE_SNAPSHOT_LEGACY_SECRETS[${index}]`,
      secret,
    })),
    ...offlineAccounting.keys.map((key) => ({
      name: `POS_OFFLINE_TICKET_KEYS[${key.id}]`,
      secret: key.secret,
    })),
  ];
  const ownerBySecret = new Map<string, string>();
  for (const entry of namedSecrets) {
    const existing = ownerBySecret.get(entry.secret);
    if (existing) {
      throw new Error(`${entry.name} must be different from ${existing}`);
    }
    ownerBySecret.set(entry.secret, entry.name);
  }

  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    directUrl: required('DIRECT_URL', env.DIRECT_URL),
    jwtSecret,
    jwtExpires: parseDuration('JWT_EXPIRES', env.JWT_EXPIRES, '15m'),
    refreshExpires: parseDuration('REFRESH_EXPIRES', env.REFRESH_EXPIRES, '30d'),
    port: parsePort(env.PORT),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    priceSnapshots,
    offlineAccounting,
  };
}
