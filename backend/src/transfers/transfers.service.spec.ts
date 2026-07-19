import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TransfersService } from './transfers.service';

describe('TransfersService', () => {
  const actor = { sub: 'manager-1', role: 'branch_manager' as const, branch_id: 'branch-1' };
  const transfer = {
    id: 'transfer-1',
    from_branch_id: 'branch-1',
    to_branch_id: 'branch-2',
    status: 'pending',
    items: [{ variant_id: 'variant-1', qty: 3 }],
  };

  function setup(stockChanged = 1) {
    const tx = {
      transfer: {
        findUnique: jest.fn().mockResolvedValue(transfer),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(stockChanged),
      inventoryStock: { upsert: jest.fn().mockResolvedValue({}) },
      branch: { count: jest.fn().mockResolvedValue(2) },
      productVariant: { count: jest.fn().mockResolvedValue(1) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    return { service: new TransfersService(prisma as any), prisma, tx };
  }

  it('prevents a branch manager from creating an outgoing transfer for another branch', async () => {
    const { service, prisma } = setup();
    await expect(service.create({
      from_branch_id: 'branch-9',
      to_branch_id: 'branch-2',
      items: [{ variant_id: 'variant-1', qty: 1 }],
    }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('claims a pending transfer and atomically decrements only available source stock', async () => {
    const { service, tx } = setup();
    await service.ship('transfer-1', actor);
    expect(tx.transfer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'transfer-1', status: 'pending' },
      data: expect.objectContaining({ status: 'shipped', shipped_by: actor.sub }),
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects shipping when available source stock is insufficient', async () => {
    const { service } = setup(0);
    await expect(service.ship('transfer-1', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('receives exactly the stored transfer quantities into the destination', async () => {
    const receiver = { ...actor, branch_id: 'branch-2' };
    const { service, tx } = setup();
    await service.receive('transfer-1', receiver);
    expect(tx.inventoryStock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { branch_id_variant_id: { branch_id: 'branch-2', variant_id: 'variant-1' } },
      update: { qty_on_hand: { increment: 3 } },
    }));
  });
});
