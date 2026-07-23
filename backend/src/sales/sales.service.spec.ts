import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { SalesService } from './sales.service';

const actor = {
  sub: '88888888-8888-4888-8888-888888888888',
  role: 'cashier' as const,
  branch_id: '11111111-1111-4111-8111-111111111111',
};
const terminal = {
  id: '22222222-2222-4222-8222-222222222222',
  branch_id: actor.branch_id,
};
const shiftId = '33333333-3333-4333-8333-333333333333';
const offlineSessionId = '44444444-4444-4444-8444-444444444444';
const variantId = '55555555-5555-4555-8555-555555555555';
const syncId = '66666666-6666-4666-8666-666666666666';
const occurredAt = '2026-07-22T10:00:00.000Z';

function saleDto(overrides: Record<string, unknown> = {}) {
  return {
    sync_id: syncId,
    branch_id: actor.branch_id,
    shift_id: shiftId,
    origin_cashier_id: actor.sub,
    offline_session_id: offlineSessionId,
    terminal_sequence: '1',
    occurred_at: occurredAt,
    offline_accounting_token: 'offline-ticket',
    items: [{ variant_id: variantId, qty: 2 }],
    payment_method: 'cash',
    local_total: 342,
    ...overrides,
  } as any;
}

function setupSale(options: {
  stockCount?: number;
  sequenceClaim?: number;
  existing?: any;
  closedShift?: boolean;
  missingClosedShiftTotals?: boolean;
} = {}) {
  const tx = {
    branch: {
      findUnique: jest.fn().mockResolvedValue({
        id: actor.branch_id,
        code: 'BOLD-01',
      }),
    },
    shift: {
      findUnique: jest.fn().mockResolvedValue({
        id: shiftId,
        branch_id: actor.branch_id,
        status: options.closedShift ? 'closed' : 'open',
        opening_cash: 50,
        closing_cash: options.closedShift ? 400 : null,
        expected_cash: options.closedShift && !options.missingClosedShiftTotals ? 400 : null,
        difference: options.closedShift && !options.missingClosedShiftTotals ? 0 : null,
        opened_at: new Date('2026-07-22T08:00:00.000Z'),
        closed_at: options.closedShift
          ? new Date('2026-07-22T12:00:00.000Z')
          : null,
      }),
      findFirst: jest.fn().mockResolvedValue({ id: shiftId }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: actor.sub,
        role: actor.role,
        branch_id: actor.branch_id,
      }),
    },
    posTerminal: {
      updateMany: jest.fn().mockResolvedValue({
        count: options.sequenceClaim ?? 1,
      }),
    },
    salesInvoice: {
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'sale-1',
          ...data,
          items: data.items.create,
        }),
      ),
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: variantId,
          product_id: 'product-1',
          cost_price: 100,
          product: { is_active: true, category_id: null, brand: null },
        },
      ]),
    },
    $executeRaw: jest.fn().mockResolvedValue(options.stockCount ?? 1),
    customer: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const pricing = {
    calculateMany: jest.fn().mockResolvedValue(
      new Map([[variantId, { net_price: 150, tax_amount: 21 }]]),
    ),
  };
  const priceSnapshots = {
    verify: jest.fn().mockReturnValue({
      branch_id: actor.branch_id,
      variant_id: variantId,
      unit_price: 150,
      unit_tax: 21,
      price_version: 'price-v1',
      issued_at: '2026-07-22T09:00:00.000Z',
    }),
  };
  const offlineAccounting = {
    clockSkewMs: 300_000,
    verifySaleContext: jest.fn().mockReturnValue({
      user_id: actor.sub,
      branch_id: actor.branch_id,
      terminal_id: terminal.id,
      shift_id: shiftId,
      session_id: offlineSessionId,
    }),
  };
  return {
    service: new SalesService(
      prisma as any,
      pricing as any,
      priceSnapshots as any,
      offlineAccounting as any,
    ),
    prisma,
    pricing,
    priceSnapshots,
    offlineAccounting,
    tx,
  };
}

function setupReturn(alreadyReturned = 0) {
  const soldItem = {
    id: 'sale-item-1',
    variant_id: variantId,
    qty: 3,
    unit_price: 150,
    unit_cost: 100,
    unit_tax: 21,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    shift: {
      findFirst: jest.fn().mockResolvedValue({ id: shiftId }),
    },
    salesInvoice: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sale-1',
        branch_id: actor.branch_id,
        customer_id: null,
        occurred_at: new Date(),
        created_at: new Date(),
        subtotal: 450,
        tax_amount: 63,
        items: [soldItem],
      }),
    },
    returnItem: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { qty: alreadyReturned },
      }),
    },
    return: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'return-1',
          ...data,
          items: data.items.create,
        }),
      ),
    },
    inventoryStock: { upsert: jest.fn().mockResolvedValue({}) },
    productVariant: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  return {
    service: new SalesService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    ),
    tx,
  };
}

describe('SalesService', () => {
  it('lists invoices by business occurrence time and caller branch scope', async () => {
    const prisma = {
      salesInvoice: {
        count: jest.fn().mockResolvedValue(21),
        findMany: jest.fn().mockResolvedValue([{ id: 'sale-1' }]),
      },
    };
    const service = new SalesService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.listSales(
      {
        q: '',
        page: 2,
        page_size: 20,
        from: '2026-07-22',
      } as any,
      actor.branch_id,
    );

    expect(prisma.salesInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branch_id: actor.branch_id,
          occurred_at: expect.any(Object),
        }),
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 20,
      }),
    );
    expect(result).toMatchObject({ total: 21, total_pages: 2, page: 2 });
  });

  it('rejects a cashier attempting to sell for another branch', async () => {
    const { service, prisma } = setupSale();
    await expect(
      service.createSale(
        saleDto({ branch_id: '77777777-7777-4777-8777-777777777777' }),
        actor,
        terminal,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists the original cashier, shift, terminal order and both timestamps', async () => {
    const { service, tx, offlineAccounting } = setupSale();
    const result = await service.createSale(saleDto(), actor, terminal);

    expect(offlineAccounting.verifySaleContext).toHaveBeenCalledWith(
      expect.objectContaining({
        offline_session_id: offlineSessionId,
        origin_cashier_id: actor.sub,
        terminal_id: terminal.id,
        shift_id: shiftId,
      }),
    );
    expect(tx.posTerminal.updateMany).toHaveBeenCalledWith({
      where: {
        id: terminal.id,
        branch_id: actor.branch_id,
        last_sale_sequence: 0n,
      },
      data: { last_sale_sequence: 1n },
    });
    expect(tx.salesInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cashier_id: actor.sub,
          received_by: actor.sub,
          terminal_id: terminal.id,
          shift_id: shiftId,
          offline_session_id: offlineSessionId,
          terminal_sequence: 1n,
          occurred_at: new Date(occurredAt),
          received_at: expect.any(Date),
        }),
      }),
    );
    expect(
      tx.salesInvoice.create.mock.calls[0][0].data.total.toFixed(2),
    ).toBe('342.00');
    expect(String(result.total)).toBe('342');
  });

  it('keeps the original cashier when another cashier uploads the offline command later', async () => {
    const uploader = {
      sub: '99999999-9999-4999-8999-999999999999',
      role: 'cashier' as const,
      branch_id: actor.branch_id,
    };
    const { service, tx } = setupSale();
    await service.createSale(saleDto(), uploader, terminal);

    expect(tx.salesInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cashier_id: actor.sub,
          received_by: uploader.sub,
          shift_id: shiftId,
        }),
      }),
    );
  });

  it('atomically reconciles a cash sale that reaches the server after its shift closed', async () => {
    const { service, tx } = setupSale({ closedShift: true });
    await service.createSale(saleDto(), actor, terminal);

    const reconciliation = tx.shift.update.mock.calls[0][0];
    expect(reconciliation.where).toEqual({ id: shiftId });
    expect(reconciliation.data.expected_cash.increment.toFixed(2)).toBe(
      '342.00',
    );
    expect(reconciliation.data.difference.decrement.toFixed(2)).toBe(
      '342.00',
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'shift.late_offline_sale.reconciled',
          entity_id: shiftId,
        }),
      }),
    );
  });


  it('rejects a late cash sale when a closed shift has no reconciliation totals', async () => {
    const { service, tx } = setupSale({
      closedShift: true,
      missingClosedShiftTotals: true,
    });

    await expect(
      service.createSale(saleDto(), actor, terminal),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.posTerminal.updateMany).not.toHaveBeenCalled();
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('persists a signed immutable price snapshot without recalculation', async () => {
    const { service, pricing, priceSnapshots } = setupSale();
    await service.createSale(
      saleDto({
        items: [{
          variant_id: variantId,
          qty: 2,
          unit_price: 150,
          unit_tax: 21,
          price_version: 'price-v1',
          price_token: 'signed-token',
        }],
      }),
      actor,
      terminal,
    );

    expect(priceSnapshots.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch_id: actor.branch_id,
        variant_id: variantId,
        unit_price: 150,
        unit_tax: 21,
      }),
    );
    expect(pricing.calculateMany).not.toHaveBeenCalled();
  });

  it('returns an idempotent replay only when its complete command fingerprint matches', async () => {
    const { service, tx } = setupSale();
    const dto = saleDto();
    const normalized = (service as any).normalizeLines(dto.items);
    const commandFingerprint = (service as any).saleCommandFingerprint(
      dto,
      terminal.id,
      new Date(occurredAt),
      normalized,
    );
    const existing = {
      id: 'sale-1',
      branch_id: actor.branch_id,
      terminal_id: terminal.id,
      shift_id: shiftId,
      cashier_id: actor.sub,
      offline_session_id: offlineSessionId,
      terminal_sequence: 1n,
      command_fingerprint: commandFingerprint,
      items: [],
    };
    tx.salesInvoice.findUnique.mockResolvedValue(existing);

    const result = await service.createSale(dto, actor, terminal);
    expect(result).toBe(existing);
    expect(tx.posTerminal.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a reused sync id with a different cashier, shift, or financial payload', async () => {
    const { service, tx } = setupSale();
    const original = saleDto();
    const normalized = (service as any).normalizeLines(original.items);
    const originalFingerprint = (service as any).saleCommandFingerprint(
      original,
      terminal.id,
      new Date(occurredAt),
      normalized,
    );
    tx.salesInvoice.findUnique.mockResolvedValue({
      id: 'sale-1',
      branch_id: actor.branch_id,
      terminal_id: terminal.id,
      shift_id: shiftId,
      cashier_id: actor.sub,
      offline_session_id: offlineSessionId,
      terminal_sequence: 1n,
      command_fingerprint: originalFingerprint,
      items: [],
    });

    await expect(
      service.createSale(
        saleDto({ payment_method: 'card' }),
        actor,
        terminal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a sequence gap before inventory or invoice mutation', async () => {
    const { service, tx } = setupSale({ sequenceClaim: 0 });
    await expect(
      service.createSale(saleDto({ terminal_sequence: '2' }), actor, terminal),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('rolls back when the guarded stock decrement fails', async () => {
    const { service, tx } = setupSale({ stockCount: 0 });
    await expect(
      service.createSale(saleDto(), actor, terminal),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('rejects an item that was not sold on the original invoice', async () => {
    const { service } = setupReturn();
    await expect(
      service.createReturn(
        {
          original_invoice_id: 'sale-1',
          items: [{ sales_invoice_item_id: 'not-on-sale', qty: 1 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects quantities greater than the returnable quantity', async () => {
    const { service } = setupReturn(2);
    await expect(
      service.createReturn(
        {
          original_invoice_id: 'sale-1',
          items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('links a POS return to the currently open shift', async () => {
    const { service, tx } = setupReturn();
    const result = await service.createReturn(
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      actor,
    );

    expect(tx.return.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          branch_id: actor.branch_id,
          shift_id: shiftId,
          created_by: actor.sub,
        }),
      }),
    );
    expect(
      tx.return.create.mock.calls[0][0].data.refund_total.toFixed(2),
    ).toBe('342.00');
    expect(String(result.refund_total)).toBe('342');
  });

  it('returns safe snapshots and remaining quantities for return lookup', async () => {
    const prisma = {
      salesInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sale-1',
          invoice_number: 'B-1',
          branch_id: actor.branch_id,
          total: 171,
          created_at: new Date(),
          items: [{
            id: 'sale-item-1',
            variant_id: variantId,
            qty: 3,
            unit_price: 150,
            unit_tax: 21,
            variant: {
              sku: 'SKU-1',
              product: { name_en: 'Shirt', name_ar: null },
            },
            return_items: [{ qty: 1 }],
          }],
        }),
      },
    };
    const service = new SalesService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const invoice = await service.findReturnableInvoice('B-1', actor);

    expect(invoice.items[0]).toEqual(
      expect.objectContaining({ returned_qty: 1, returnable_qty: 2 }),
    );
    expect(invoice.items[0]).not.toHaveProperty('unit_cost');
    expect(invoice.items[0]).not.toHaveProperty('return_items');
  });
});
