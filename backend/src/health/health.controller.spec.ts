import { ServiceUnavailableException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('exposes a public process liveness response without touching PostgreSQL', () => {
    const prisma = {
      $queryRawUnsafe: jest.fn(),
    };
    const controller = new HealthController(prisma as any);

    expect(controller.live()).toEqual({
      status: 'ok',
      service: 'bold-pos-api',
    });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        HealthController.prototype.live,
      ),
    ).toBe(true);
  });

  it('reports readiness only after PostgreSQL responds', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ value: 1 }]),
    };
    const controller = new HealthController(prisma as any);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      service: 'bold-pos-api',
      database: 'ready',
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        HealthController.prototype.ready,
      ),
    ).toBe(true);
  });

  it('returns a sanitized service-unavailable response when PostgreSQL fails', async () => {
    const prisma = {
      $queryRawUnsafe: jest
        .fn()
        .mockRejectedValue(new Error('postgresql://secret@private-host')),
    };
    const controller = new HealthController(prisma as any);

    await expect(controller.ready()).rejects.toEqual(
      new ServiceUnavailableException({
        status: 'error',
        service: 'bold-pos-api',
        database: 'unavailable',
      }),
    );
  });
});
