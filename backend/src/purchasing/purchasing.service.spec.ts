import { BadRequestException } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';

describe('PurchasingService', () => {
  const actor = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'branch_manager' as const,
    branch_id: '22222222-2222-4222-8222-222222222222',
  };
  const dto = {
    supplier_id: '33333333-3333-4333-8333-333333333333',
    branch_id: actor.branch_id,
    items: [
      {
        variant_id: '44444444-4444-4444-8444-444444444444',
        qty: 2,
        unit_cost: 120,
      },
    ],
  };

  function setup() {
    const tx = {
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: dto.branch_id }),
      },
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ id: dto.supplier_id }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([
          { id: dto.items[0].variant_id, cost_price: 100 },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      inventoryStock: {
        groupBy: jest.fn().mockResolvedValue([
          {
            variant_id: dto.items[0].variant_id,
            _sum: { qty_on_hand: 8 },
          },
        ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      purchaseInvoice: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: '55555555-5555-4555-8555-555555555555',
            created_at: new Date('2026-07-22T12:00:00.000Z'),
            ...data,
            items: [
              {
                id: '66666666-6666-4666-8666-666666666666',
                variant_id: dto.items[0].variant_id,
                qty: 2,
                unit_cost: 120,
              },
            ],
          }),
        ),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { record_inventory_movement: 'movement-1' },
      ]),
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    return {
      service: new PurchasingService(prisma as any),
      prisma,
      tx,
    };
  }

  it('creates the invoice, ledger movement, stock, actor attribution, and weighted cost in one transaction', async () => {
    const { service, prisma, tx } = setup();
    await service.receive(dto, actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.purchaseInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          created_by: actor.sub,
          subtotal: expect.anything(),
          total: expect.anything(),
        }),
      }),
    );
    expect(tx.inventoryStock.upsert).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cost_price: expect.anything() },
      }),
    );
    expect(
      Number(tx.productVariant.update.mock.calls[0][0].data.cost_price),
    ).toBe(104);
  });

  it('rolls back the purchase transaction when the ledger rejects the stock mutation', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockRejectedValueOnce(new Error('Inventory ledger mismatch'));

    await expect(service.receive(dto, actor)).rejects.toThrow(
      'Inventory ledger mismatch',
    );
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });

  it('rejects ambiguous double discounts before opening a transaction', async () => {
    const { service, prisma } = setup();
    await expect(
      service.receive(
        { ...dto, discount_amount: 5, discount_percent: 5 },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
