import { BadRequestException } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';

describe('PurchasingService', () => {
  const actor = { sub: 'user-1', role: 'branch_manager' as const, branch_id: 'branch-1' };
  const dto = {
    supplier_id: 'supplier-1',
    branch_id: 'branch-1',
    items: [{ variant_id: 'variant-1', qty: 2, unit_cost: 120 }],
  };

  function setup() {
    const tx = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-1' }) },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([{ id: 'variant-1', cost_price: 100 }]),
        update: jest.fn().mockResolvedValue({}),
      },
      inventoryStock: {
        groupBy: jest.fn().mockResolvedValue([{ variant_id: 'variant-1', _sum: { qty_on_hand: 8 } }]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      purchaseInvoice: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'purchase-1', ...data })),
      },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    return { service: new PurchasingService(prisma as any), prisma, tx };
  }

  it('creates the invoice, stock, actor attribution, and weighted cost in one transaction', async () => {
    const { service, prisma, tx } = setup();
    await service.receive(dto, actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.purchaseInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ created_by: actor.sub, subtotal: expect.anything(), total: expect.anything() }),
    }));
    expect(tx.inventoryStock.upsert).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { cost_price: expect.anything() },
    }));
    expect(Number(tx.productVariant.update.mock.calls[0][0].data.cost_price)).toBe(104);
  });

  it('rejects ambiguous double discounts before opening a transaction', async () => {
    const { service, prisma } = setup();
    await expect(service.receive({ ...dto, discount_amount: 5, discount_percent: 5 }, actor))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
