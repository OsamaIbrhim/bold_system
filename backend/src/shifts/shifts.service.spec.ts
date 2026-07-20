import { ShiftsService } from './shifts.service';

describe('ShiftsService', () => {
  it('calculates expected cash from cash sales less cash-sale returns', async () => {
    const actor = { sub: 'cashier-1', role: 'cashier' as const, branch_id: 'branch-1' };
    const shiftFindUnique = jest.fn()
      .mockResolvedValueOnce({
        id: 'shift-1', branch_id: 'branch-1', status: 'open', opening_cash: 50, opened_at: new Date(0),
      })
      .mockResolvedValueOnce({ id: 'shift-1', status: 'closed' });
    const shiftUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const salesAggregate = jest.fn().mockResolvedValue({ _sum: { total: 500 } });
    const returnAggregate = jest.fn().mockResolvedValue({ _sum: { refund_total: 100 } });

    const prisma = {
      shift: {
        findUnique: shiftFindUnique,
        updateMany: shiftUpdateMany,
      },
      salesInvoice: { aggregate: salesAggregate },
      return: { aggregate: returnAggregate },
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const service = new ShiftsService(prisma as any);

    await service.close('shift-1', actor, 440);
    const data = shiftUpdateMany.mock.calls[0][0].data;
    expect(Number(data.expected_cash)).toBe(450);
    expect(Number(data.difference)).toBe(-10);
    expect(data.closed_by).toBe(actor.sub);
  });
});