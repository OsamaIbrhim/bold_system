import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TerminalsService } from './terminals.service';

describe('TerminalsService', () => {
  const actor = { sub: 'user-1', role: 'cashier' as const, branch_id: 'branch-1' };
  const dto = { device_id: '93de7eb8-4fbe-4f78-8c83-2fefea327ffc', sync_status: 'success', pending_count: 0 };

  it('registers a heartbeat only in the authenticated branch', async () => {
    const prisma = {
      posTerminal: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
    };
    const service = new TerminalsService(prisma as any);
    const result = await service.heartbeat(dto, actor);
    expect(prisma.posTerminal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ branch_id: 'branch-1', device_id: dto.device_id }),
    }));
    expect(result.online).toBe(true);
  });

  it('rejects a device already registered to another branch', async () => {
    const prisma = { posTerminal: { findUnique: jest.fn().mockResolvedValue({ branch_id: 'branch-2', is_revoked: false }) } };
    await expect(new TerminalsService(prisma as any).heartbeat(dto, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not allow a revoked device to register itself again', async () => {
    const prisma = { posTerminal: { findUnique: jest.fn().mockResolvedValue({ branch_id: 'branch-1', is_revoked: true }) } };
    await expect(new TerminalsService(prisma as any).heartbeat(dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('derives online state from the heartbeat time instead of persisting a stale boolean', async () => {
    const prisma = { posTerminal: { findMany: jest.fn().mockResolvedValue([
      { id: 'online', is_revoked: false, last_seen_at: new Date(Date.now() - 1000) },
      { id: 'offline', is_revoked: false, last_seen_at: new Date(Date.now() - 120000) },
    ]) } };
    const result = await new TerminalsService(prisma as any).list({ ...actor, role: 'owner' });
    expect(result.items.map((item:any) => [item.id, item.online])).toEqual([['online', true], ['offline', false]]);
  });
});
