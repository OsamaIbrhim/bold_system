import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { TransfersService } from './transfers.service';

const SOURCE_BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const DESTINATION_BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const TRANSFER_ID = '44444444-4444-4444-8444-444444444444';
const TRANSFER_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const VARIANT_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_ACTOR_ID = '77777777-7777-4777-8777-777777777777';
const DESTINATION_ACTOR_ID = '88888888-8888-4888-8888-888888888888';
const CREATE_COMMAND_ID = '99999999-9999-4999-8999-999999999999';
const SHIP_COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIVE_COMMAND_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CANCEL_COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sourceActor = {
  sub: SOURCE_ACTOR_ID,
  role: 'warehouse_manager' as const,
  branch_id: SOURCE_BRANCH_ID,
};
const destinationActor = {
  sub: DESTINATION_ACTOR_ID,
  role: 'warehouse_manager' as const,
  branch_id: DESTINATION_BRANCH_ID,
};
const branchManager = {
  sub: SOURCE_ACTOR_ID,
  role: 'branch_manager' as const,
  branch_id: SOURCE_BRANCH_ID,
};

const pendingTransfer = {
  id: TRANSFER_ID,
  from_branch_id: SOURCE_BRANCH_ID,
  to_branch_id: DESTINATION_BRANCH_ID,
  status: 'pending',
  command_fingerprint: null,
};

const shippedItem = {
  id: TRANSFER_ITEM_ID,
  variant_id: VARIANT_ID,
  qty: 3,
  shipped_qty: 3,
  received_qty: 0,
  damaged_qty: 0,
  missing_qty: 0,
};

function setup() {
  const loadedTransfer = {
    ...pendingTransfer,
    transfer_number: 'TR-20260723-00000001',
    items: [shippedItem],
    from_branch: { id: SOURCE_BRANCH_ID },
    to_branch: { id: DESTINATION_BRANCH_ID },
  };
  const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    transfer: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(loadedTransfer),
      findUnique: jest.fn().mockResolvedValue(loadedTransfer),
    },
    inventoryStock: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    branch: {
      count: jest.fn().mockResolvedValue(2),
    },
    productVariant: {
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
    transfer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const service = new TransfersService(prisma as any);
  return { service, prisma, tx, loadedTransfer };
}

function mockCommandFlow(
  service: TransfersService,
  options: {
    transfer?: typeof pendingTransfer;
    items?: typeof shippedItem[];
    replay?: boolean;
    result?: unknown;
  } = {},
) {
  jest
    .spyOn(service as any, 'enableTransferCommand')
    .mockResolvedValue(undefined);
  jest
    .spyOn(service as any, 'lockTransfer')
    .mockResolvedValue(options.transfer || pendingTransfer);
  jest
    .spyOn(service as any, 'replayCommand')
    .mockResolvedValue(options.replay || false);
  jest
    .spyOn(service as any, 'lockItems')
    .mockResolvedValue(options.items || [shippedItem]);
  jest.spyOn(service as any, 'recordCommand').mockResolvedValue(1);
  jest.spyOn(service as any, 'audit').mockResolvedValue({});
  jest
    .spyOn(service as any, 'loadTransfer')
    .mockResolvedValue(options.result || { id: TRANSFER_ID });
}

describe('TransfersService', () => {
  it('prevents a branch manager from creating an outgoing transfer for another branch', async () => {
    const { service, prisma } = setup();

    await expect(
      service.create(
        {
          from_branch_id: OTHER_BRANCH_ID,
          to_branch_id: DESTINATION_BRANCH_ID,
          command_id: CREATE_COMMAND_ID,
          items: [{ variant_id: VARIANT_ID, qty: 1 }],
        },
        branchManager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ships a pending transfer using the command DTO and atomically decrements available source stock', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service);

    await service.ship(
      TRANSFER_ID,
      { command_id: SHIP_COMMAND_ID },
      sourceActor,
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect((service as any).recordCommand).toHaveBeenCalledWith(
      tx,
      TRANSFER_ID,
      'ship',
      SHIP_COMMAND_ID,
      expect.any(String),
      'shipped',
      SOURCE_ACTOR_ID,
    );
    expect((service as any).audit).toHaveBeenCalledWith(
      tx,
      SOURCE_ACTOR_ID,
      'transfer.shipped',
      TRANSFER_ID,
      expect.objectContaining({ command_id: SHIP_COMMAND_ID }),
    );
  });

  it('rejects shipping when available source stock is insufficient', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service);
    tx.$executeRaw.mockResolvedValueOnce(0);

    await expect(
      service.ship(
        TRANSFER_ID,
        { command_id: SHIP_COMMAND_ID },
        sourceActor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((service as any).recordCommand).not.toHaveBeenCalled();
  });

  it('returns the stored result for an idempotent ship replay without mutating stock', async () => {
    const { service, tx } = setup();
    const replayed = { id: TRANSFER_ID, status: 'shipped' };
    mockCommandFlow(service, { replay: true, result: replayed });

    await expect(
      service.ship(
        TRANSFER_ID,
        { command_id: SHIP_COMMAND_ID },
        sourceActor,
      ),
    ).resolves.toEqual(replayed);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect((service as any).recordCommand).not.toHaveBeenCalled();
  });

  it('receives the requested quantity into the destination and completes the transfer', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });
    tx.$queryRaw.mockResolvedValueOnce([{ quantity: 0n }]);

    await service.receive(
      TRANSFER_ID,
      {
        command_id: RECEIVE_COMMAND_ID,
        items: [
          {
            transfer_item_id: TRANSFER_ITEM_ID,
            received_qty: 3,
          },
        ],
      },
      destinationActor,
    );

    expect(tx.inventoryStock.upsert).toHaveBeenCalledWith({
      where: {
        branch_id_variant_id: {
          branch_id: DESTINATION_BRANCH_ID,
          variant_id: VARIANT_ID,
        },
      },
      update: { qty_on_hand: { increment: 3 } },
      create: {
        branch_id: DESTINATION_BRANCH_ID,
        variant_id: VARIANT_ID,
        qty_on_hand: 3,
      },
    });
    expect((service as any).recordCommand).toHaveBeenCalledWith(
      tx,
      TRANSFER_ID,
      'receive',
      RECEIVE_COMMAND_ID,
      expect.any(String),
      'received',
      DESTINATION_ACTOR_ID,
    );
  });

  it('keeps the transfer partially received while units remain in transit', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
      items: [{ ...shippedItem, qty: 5, shipped_qty: 5 }],
    });
    tx.$queryRaw.mockResolvedValueOnce([{ quantity: 2n }]);

    await service.receive(
      TRANSFER_ID,
      {
        command_id: RECEIVE_COMMAND_ID,
        items: [
          {
            transfer_item_id: TRANSFER_ITEM_ID,
            received_qty: 3,
          },
        ],
      },
      destinationActor,
    );

    expect((service as any).recordCommand).toHaveBeenCalledWith(
      tx,
      TRANSFER_ID,
      'receive',
      RECEIVE_COMMAND_ID,
      expect.any(String),
      'partially_received',
      DESTINATION_ACTOR_ID,
    );
  });

  it('adds only received units to stock while resolving damaged and missing units', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });
    tx.$queryRaw.mockResolvedValueOnce([{ quantity: 0n }]);

    await service.receive(
      TRANSFER_ID,
      {
        command_id: RECEIVE_COMMAND_ID,
        items: [
          {
            transfer_item_id: TRANSFER_ITEM_ID,
            received_qty: 1,
            damaged_qty: 1,
            missing_qty: 1,
          },
        ],
      },
      destinationActor,
    );

    expect(tx.inventoryStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { qty_on_hand: { increment: 1 } },
        create: expect.objectContaining({ qty_on_hand: 1 }),
      }),
    );
  });

  it('rejects duplicate transfer items in a receipt command', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });

    await expect(
      service.receive(
        TRANSFER_ID,
        {
          command_id: RECEIVE_COMMAND_ID,
          items: [
            {
              transfer_item_id: TRANSFER_ITEM_ID,
              received_qty: 1,
            },
            {
              transfer_item_id: TRANSFER_ITEM_ID,
              received_qty: 1,
            },
          ],
        },
        destinationActor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryStock.upsert).not.toHaveBeenCalled();
  });

  it('cancels only a pending transfer through an idempotent command DTO', async () => {
    const { service, tx } = setup();
    mockCommandFlow(service);

    await service.cancel(
      TRANSFER_ID,
      {
        command_id: CANCEL_COMMAND_ID,
        reason: 'Created for the wrong destination',
      },
      sourceActor,
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((service as any).recordCommand).toHaveBeenCalledWith(
      tx,
      TRANSFER_ID,
      'cancel',
      CANCEL_COMMAND_ID,
      expect.any(String),
      'cancelled',
      SOURCE_ACTOR_ID,
    );
  });
});
