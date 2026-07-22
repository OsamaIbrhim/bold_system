import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { configureDatabaseConnection } from '../config/database-connection'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly warmConnections: number

  constructor() {
    const configuration = configureDatabaseConnection()
    super({
      datasources: {
        db: { url: configuration.databaseUrl },
      },
    })
    this.warmConnections = configuration.warmConnections
  }

  async onModuleInit() {
    await this.$connect()

    // Prisma opens additional pool connections lazily. On a high-latency remote
    // database that made the first concurrent requests pay connection setup
    // costs of roughly one second. Hold each warm-up query briefly so Prisma
    // opens the bounded pool concurrently before the API starts accepting work.
    await Promise.all(
      Array.from({ length: this.warmConnections }, () =>
        this.$queryRawUnsafe(
          'SELECT 1::integer AS value FROM pg_sleep(0.05)',
        ),
      ),
    )
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
