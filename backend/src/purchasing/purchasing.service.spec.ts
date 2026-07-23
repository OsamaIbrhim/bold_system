import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchasingService } from './purchasing.service';

describe('PurchasingService accounting transaction', () => {
  const actor = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'branch_manager' as const,
    branch_id: '22222222-2222-4222-8222-222222222222',
  };
  const dto = {
    command_id: '99999999-9999-4999-8999-999999999999',
    supplier_id: '33333333-3333-4333-8333-333333333333',
    branch_id: actor.branch_id,
    invoice_number: 'SUP-42',
    discount_amount: 20,
    items: [
      {
        variant_id: '44444444-4444-4444-8444-444444444444',
        qty: 2,
        unit_cost: 120,
      },
    ],
  };

  function setup(existing: any = null) {
    const itemId = '66666666-6666-4666-8666-666666666666';
    const invoiceId = '55555555-5555-4555-8555-555555555555';
    const tx = {
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({
          id: invoiceId,
          branch_id: dto.branch_id,
          created_at: new Date(),
          items: [{
            id: itemId,
            variant_id: dto.items[0].variant_id,
            qty: 2,
          }],
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: invoiceId,
          items: [],
          cost_movements: [],
        }),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: dto.branch_id }),
      },
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ id: dto.supplier_id }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([
          { id: dto.items[0].variant_id },
        ]),
      },
      inventoryStock: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      inventoryCostMovement: {
        findUnique: jest.fn().mockResolvedValue({
          global_quantity_before: 8,
          global_quantity_after: 10,
          cost_before: 100,
          cost_after: 104,
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue(existing),
      },
    };
    return {
      service: new PurchasingService(prisma as any),
      prisma,
      tx,
    };
  }

  it('posts stock, quantity ledger, cost ledger and line snapshots atomically', async () => {
    const { service, prisma, tx } = setup();
    await service.receive(dto, actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.inventoryStock.upsert).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns an identical replay without mutating stock', async () => {
    const first = setup();
    const prepared = await first.service.receive(dto, actor);
    const fingerprint =
      first.tx.purchaseInvoice.create.mock.calls[0][0].data
        .command_fingerprint;
    const replay = {
      id: 'existing',
      command_fingerprint: fingerprint,
      items: [],
      cost_movements: [],
    };
    const second = setup(replay);
    const result = await second.service.receive(dto, actor);

    expect(result).toBe(replay);
    expect(second.tx.purchaseInvoice.create).not.toHaveBeenCalled();
    expect(second.tx.inventoryStock.upsert).not.toHaveBeenCalled();
    expect(prepared).toBeDefined();
  });

  it('rejects an idempotency replay with different accounting data', async () => {
    const { service, tx } = setup({
      id: 'existing',
      command_fingerprint: 'different',
      items: [],
      cost_movements: [],
    });

    await expect(service.receive(dto, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.inventoryStock.upsert).not.toHaveBeenCalled();
  });

  it('rejects ambiguous double discounts before opening a transaction', async () => {
    const { service, prisma } = setup();

    await expect(
      service.receive(
        {
          ...dto,
          discount_percent: 5,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });


  it('posts a partial supplier return with exact credit and current-average inventory value', async () => {
    const purchaseLineId = '77777777-7777-4777-8777-777777777777';
    const supplierReturnId = '88888888-8888-4888-8888-888888888888';
    const supplierReturnItemId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      supplierReturn: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: supplierReturnId,
            ...data,
            items: [{
              id: supplierReturnItemId,
              purchase_invoice_item_id: purchaseLineId,
              variant_id: dto.items[0].variant_id,
              qty: 2,
            }],
          }),
        ),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: supplierReturnId,
          items: [],
          cost_movements: [],
        }),
      },
      purchaseInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'purchase-1',
          supplier_id: dto.supplier_id,
          branch_id: dto.branch_id,
          status: 'posted',
          accounting_version: 2,
          discount_amount: new Prisma.Decimal(20),
          items: [{
            id: purchaseLineId,
            variant_id: dto.items[0].variant_id,
            qty: 10,
            unit_cost: new Prisma.Decimal(100),
            net_unit_cost: new Prisma.Decimal(90),
            net_line_total: new Prisma.Decimal(900),
          }],
        }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([{
          id: dto.items[0].variant_id,
          cost_price: new Prisma.Decimal(80),
        }]),
      },
      supplierReturnItem: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      supplierReturn: {
        findUnique: jest.fn(),
      },
    };
    const service = new PurchasingService(prisma as any);

    await service.returnToSupplier(
      'purchase-1',
      {
        command_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reason: 'Damaged supplier stock',
        items: [{
          purchase_invoice_item_id: purchaseLineId,
          qty: 2,
        }],
      },
      actor,
    );

    expect(tx.supplierReturn.create).toHaveBeenCalledTimes(1);
    const created =
      tx.supplierReturn.create.mock.calls[0][0].data;
    expect(created.credit_total.toFixed(2)).toBe('180.00');
    expect(created.inventory_value_removed.toFixed(2)).toBe('160.00');
    expect(created.purchase_price_variance.toFixed(2)).toBe('20.00');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

});
