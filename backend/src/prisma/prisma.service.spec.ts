import { PrismaService } from './prisma.service'

describe('PrismaService pool warm-up', () => {
  const original = { ...process.env }

  afterEach(async () => {
    process.env = { ...original }
    jest.restoreAllMocks()
  })

  it('opens the configured bounded pool before serving requests', async () => {
    process.env.DATABASE_URL =
      'postgresql://user:pass@localhost:5432/bold?connection_limit=3&pool_timeout=10&connect_timeout=15'
    process.env.DIRECT_URL =
      'postgresql://user:pass@localhost:5432/bold?connect_timeout=30'
    process.env.DB_POOL_WARM_CONNECTIONS = '3'

    const service = new PrismaService()
    const connect = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined)
    const query = jest
      .spyOn(service, '$queryRawUnsafe')
      .mockResolvedValue([{ value: 1 }] as any)

    await service.onModuleInit()

    expect(connect).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(3)
    expect(query).toHaveBeenCalledWith(
      'SELECT 1::integer AS value FROM pg_sleep(0.05)',
    )
    await service.$disconnect()
  })
})
