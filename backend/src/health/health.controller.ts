import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'bold-pos-api',
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return {
        status: 'ok',
        service: 'bold-pos-api',
        database: 'ready',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'bold-pos-api',
        database: 'unavailable',
      });
    }
  }
}
