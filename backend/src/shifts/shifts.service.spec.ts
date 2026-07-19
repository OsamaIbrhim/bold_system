import { ShiftsService } from './shifts.service';

describe('ShiftsService', () => {
  it('calculates expected cash from cash sales less cash-sale returns', async () => {
    const actor = { sub: 'cashier-1', role: 'cashier' as const, branch_id: 'branch-1' };
    const tx = {
      shift: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'shift-1', branch_id: 'branch-1', status: 'open', opening_cash: 50, opened_at: new Date(0),
          })
          .mockResolvedValueOnce({ id: 'shift-1', status: 'closed' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      salesInvoice: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 500 } }) },
      return: { aggregate: jest.fn().mockResolvedValue({ _sum: { refund_total: 100 } }) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ShiftsService(prisma as any);

    await service.close('shift-1', actor, 440);
    const data = tx.shift.updateMany.mock.calls[0][0].data;
    expect(Number(data.expected_cash)).toBe(450);
    expect(Number(data.difference)).toBe(-10);
    expect(data.closed_by).toBe(actor.sub);
  });
});
