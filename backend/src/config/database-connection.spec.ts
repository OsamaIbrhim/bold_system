import { configureDatabaseConnection } from './database-connection'

function baseEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL:
      'postgresql://user:pass@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
    DIRECT_URL:
      'postgresql://user:pass@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?connect_timeout=30',
  }
}

describe('database connection configuration', () => {
  it('bounds the Prisma runtime pool independently of host CPU count', () => {
    const env = baseEnv()
    const config = configureDatabaseConnection(env)
    const runtime = new URL(env.DATABASE_URL!)

    expect(config).toMatchObject({
      connectionLimit: 5,
      poolTimeoutSeconds: 10,
      connectTimeoutSeconds: 15,
      warmConnections: 5,
    })
    expect(runtime.searchParams.get('connection_limit')).toBe('5')
    expect(runtime.searchParams.get('pool_timeout')).toBe('10')
    expect(runtime.searchParams.get('connect_timeout')).toBe('15')
  })

  it('adds Prisma transaction-pool compatibility only on Supavisor port 6543', () => {
    const env = baseEnv()
    env.DATABASE_URL =
      'postgresql://user:pass@aws-1-eu-central-1.pooler.supabase.com:6543/postgres'
    configureDatabaseConnection(env)

    expect(new URL(env.DATABASE_URL).searchParams.get('pgbouncer')).toBe('true')
  })

  it('rejects transaction pooling for migration and administration traffic', () => {
    const env = baseEnv()
    env.DIRECT_URL =
      'postgresql://user:pass@aws-1-eu-central-1.pooler.supabase.com:6543/postgres'

    expect(() => configureDatabaseConnection(env)).toThrow(/DIRECT_URL/)
  })

  it('rejects an oversized pool and warm-up count', () => {
    const env = baseEnv()
    env.DATABASE_URL += '?connection_limit=17'
    expect(() => configureDatabaseConnection(env)).toThrow(/between 1 and 10/)

    const second = baseEnv()
    second.DATABASE_URL += '?connection_limit=3'
    second.DB_POOL_WARM_CONNECTIONS = '4'
    expect(() => configureDatabaseConnection(second)).toThrow(/between 1 and 3/)
  })
})
