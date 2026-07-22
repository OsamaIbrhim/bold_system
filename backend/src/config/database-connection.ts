const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:'])

export type DatabaseConnectionConfiguration = {
  databaseUrl: string
  directUrl: string
  connectionLimit: number
  poolTimeoutSeconds: number
  connectTimeoutSeconds: number
  warmConnections: number
}

function required(name: string, value: string | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${name} must be configured`)
  return normalized
}

function parseUrl(name: string, value: string | undefined) {
  const raw = required(name, value)
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL`)
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${name} must use the postgres or postgresql protocol`)
  }

  return url
}

function boundedInteger(
  name: string,
  raw: string | null | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(raw ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

function isSupabaseSharedPooler(url: URL) {
  return url.hostname.endsWith('.pooler.supabase.com')
}

/**
 * Prisma v5 otherwise sizes its pool from host CPU count. That produced a
 * 17-connection local pool in this project and exhausted the shared Supavisor
 * allowance while connections were still being opened lazily. Normalize every
 * runtime URL before Nest constructs PrismaClient so local, CI, and Railway use
 * the same bounded, documented pool.
 */
export function configureDatabaseConnection(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConnectionConfiguration {
  const runtime = parseUrl('DATABASE_URL', env.DATABASE_URL)
  const direct = parseUrl('DIRECT_URL', env.DIRECT_URL)

  const connectionLimit = boundedInteger(
    'DATABASE_URL connection_limit',
    runtime.searchParams.get('connection_limit'),
    5,
    1,
    10,
  )
  const poolTimeoutSeconds = boundedInteger(
    'DATABASE_URL pool_timeout',
    runtime.searchParams.get('pool_timeout'),
    10,
    1,
    30,
  )
  const connectTimeoutSeconds = boundedInteger(
    'DATABASE_URL connect_timeout',
    runtime.searchParams.get('connect_timeout'),
    15,
    1,
    60,
  )

  runtime.searchParams.set('connection_limit', String(connectionLimit))
  runtime.searchParams.set('pool_timeout', String(poolTimeoutSeconds))
  runtime.searchParams.set('connect_timeout', String(connectTimeoutSeconds))

  if (isSupabaseSharedPooler(runtime) && runtime.port === '6543') {
    // Supavisor transaction mode cannot retain prepared statements.
    runtime.searchParams.set('pgbouncer', 'true')
  } else if (isSupabaseSharedPooler(runtime)) {
    // Session mode supports prepared statements; retain their performance.
    runtime.searchParams.delete('pgbouncer')
  }

  if (isSupabaseSharedPooler(direct) && direct.port === '6543') {
    throw new Error(
      'DIRECT_URL must use Supavisor session mode on port 5432 (or a direct database URL), not transaction mode on 6543',
    )
  }

  const warmConnections = boundedInteger(
    'DB_POOL_WARM_CONNECTIONS',
    env.DB_POOL_WARM_CONNECTIONS,
    Math.min(5, connectionLimit),
    1,
    connectionLimit,
  )

  const databaseUrl = runtime.toString()
  const directUrl = direct.toString()

  // Prisma reads the datasource directly from process.env. Keep the normalized
  // URL in the active process without ever logging credentials.
  env.DATABASE_URL = databaseUrl
  env.DIRECT_URL = directUrl

  return {
    databaseUrl,
    directUrl,
    connectionLimit,
    poolTimeoutSeconds,
    connectTimeoutSeconds,
    warmConnections,
  }
}
