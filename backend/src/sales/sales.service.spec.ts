import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SalesService } from './sales.service';

describe('SalesService', () => {
  const actor = { sub: 'user-1', role: 'cashier' as const, branch_id: 'branch-1' };
  const dto = {
    sync_id: '71ef19d9-c60c-4e12-a9c7-4f73cb9a8132',
    branch_id: 'branch-1',
    items: [{ variant_id: 'd6c4d58e-e284-4c74-8f59-b33762276b32', qty: 2 }],
    payment_method: 'cash',
    language: 'ar',
  };

  it('lists invoices in pages and applies the caller branch scope', async () => {
    const prisma = {
      salesInvoice: {
        count: jest.fn().mockResolvedValue(21),
        findMany: jest.fn().mockResolvedValue([{ id: 'sale-1' }]),
      },
    };
    const service = new SalesService(prisma as any, {} as any);
    const result = await service.listSales({ q:'', page:2, page_size:20 } as any, 'branch-1');
    expect(prisma.salesInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { branch_id:'branch-1' }, skip:20, take:20,
    }));
    expect(result).toMatchObject({ total:21, total_pages:2, page:2 });
    expect(prisma.salesInvoice.count).toHaveBeenCalledTimes(1);
  });

  function setup(stockCount = 1) {
    const tx = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1', code: 'BOLD-01' }) },
      salesInvoice: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sale-1', ...data, items: data.items.create })),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([{
          id: dto.items[0].variant_id,
          product_id: 'product-1',
          cost_price: 100,
          product: { is_active: true, category_id: null, brand: null },
        }]),
      },
      $executeRaw: jest.fn().mockResolvedValue(stockCount),
      inventoryStock: {},
      customer: { upsert: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const pricing = {
      calculateMany: jest.fn().mockResolvedValue(new Map([
        [dto.items[0].variant_id, { net_price: 150, tax_amount: 21 }],
      ])),
    };
    return { service: new SalesService(prisma as any, pricing as any), prisma, pricing, tx };
  }

  it('rejects a cashier attempting to sell for another branch', async () => {
    const { service, prisma } = setup();
    await expect(service.createSale({ ...dto, branch_id: 'branch-2' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses server price, server cost, authenticated cashier, and one transaction', async () => {
    const { service, prisma, pricing, tx } = setup();
    const result = await service.createSale(dto, actor, 'terminal-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(pricing.calculateMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: dto.items[0].variant_id }),
    ]), tx);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.salesInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cashier_id: actor.sub,
        terminal_id: 'terminal-1',
        subtotal: 300,
        tax_amount: 42,
        total: 342,
        items: { create: [expect.objectContaining({ unit_price: 150, unit_cost: 100, qty: 2 })] },
      }),
    }));
    expect(result.total).toBe(342);
  });

  it('rolls back the command when guarded stock decrement cannot be applied', async () => {
    const { service, tx } = setup(0);
    await expect(service.createSale(dto, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  function setupReturn(alreadyReturned = 0) {
    const soldItem = {
      id: 'sale-item-1',
      variant_id: 'variant-1',
      qty: 3,
      unit_price: 150,
      unit_cost: 100,
      unit_tax: 21,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      salesInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sale-1',
          branch_id: 'branch-1',
          customer_id: null,
          created_at: new Date(),
          subtotal: 450,
          tax_amount: 63,
          items: [soldItem],
        }),
      },
      returnItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { qty: alreadyReturned } }) },
      return: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'return-1', ...data, items: data.items.create })),
      },
      inventoryStock: { upsert: jest.fn().mockResolvedValue({}) },
      productVariant: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customer: { findUnique: jest.fn(), update: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    return { service: new SalesService(prisma as any, {} as any), tx };
  }

  it('rejects an item that was not sold on the original invoice', async () => {
    const { service } = setupReturn();
    await expect(service.createReturn({
      original_invoice_id: 'sale-1',
      items: [{ sales_invoice_item_id: 'not-on-sale', qty: 1 }],
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects quantities greater than the remaining returnable quantity', async () => {
    const { service } = setupReturn(2);
    await expect(service.createReturn({
      original_invoice_id: 'sale-1',
      items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
    }, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records return lines and refund totals atomically', async () => {
    const { service, tx } = setupReturn();
    const result = await service.createReturn({
      original_invoice_id: 'sale-1',
      items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
      reason: 'Wrong size',
    }, actor);

    expect(tx.return.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        branch_id: 'branch-1',
        created_by: actor.sub,
        refund_subtotal: 300,
        refund_tax: 42,
        refund_total: 342,
        items: { create: [expect.objectContaining({ sales_invoice_item_id: 'sale-item-1', qty: 2 })] },
      }),
    }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.inventoryStock.upsert).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { return_count: { increment: 2 } },
    }));
    expect(result.refund_total).toBe(342);
  });

  it('returns only safe sale snapshots and remaining quantities for POS return lookup', async () => {
    const prisma = {
      salesInvoice: { findUnique: jest.fn().mockResolvedValue({
        id: 'sale-1', invoice_number: 'B-1', branch_id: 'branch-1', total: 171,
        created_at: new Date(),
        items: [{
          id: 'sale-item-1', variant_id: 'variant-1', qty: 3, unit_price: 150, unit_tax: 21,
          variant: { sku: 'SKU-1', product: { name_en: 'Shirt', name_ar: null } },
          return_items: [{ qty: 1 }],
        }],
      }) },
    };
    const service = new SalesService(prisma as any, {} as any);
    const invoice = await service.findReturnableInvoice('B-1', actor);
    expect(invoice.items[0]).toEqual(expect.objectContaining({ returned_qty: 1, returnable_qty: 2 }));
    expect(invoice.items[0]).not.toHaveProperty('unit_cost');
    expect(invoice.items[0]).not.toHaveProperty('return_items');
  });
});
