import { ShiftsService } from './shifts.service';

const actor = {
  sub: 'cashier-1',
  role: 'cashier' as const,
  branch_id: 'branch-1',
};

describe('ShiftsService', () => {
  it('calculates expected cash from sales and returns explicitly linked to the shift', async () => {
    const shiftFindUnique = jest.fn()
      .mockResolvedValueOnce({
        id: 'shift-1',
        branch_id: 'branch-1',
        status: 'open',
        opening_cash: 50,
        opened_at: new Date(0),
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
    };
    const service = new ShiftsService(prisma as any, {} as any);

    await service.close('shift-1', actor, 440);

    expect(salesAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shift_id: 'shift-1' }),
      }),
    );
    expect(returnAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shift_id: 'shift-1' }),
      }),
    );
    const data = shiftUpdateMany.mock.calls[0][0].data;
    expect(Number(data.expected_cash)).toBe(450);
    expect(Number(data.difference)).toBe(-10);
    expect(data.closed_by).toBe(actor.sub);
  });

  it('issues a terminal-bound signed context only for an open shift in the same branch', async () => {
    const prisma = {
      shift: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'shift-1',
          branch_id: 'branch-1',
          status: 'open',
          closed_at: null,
        }),
      },
    };
    const tickets = {
      issue: jest.fn().mockReturnValue({ token: 'signed' }),
    };
    const service = new ShiftsService(prisma as any, tickets as any);
    const result = await service.issueOfflineContext(
      'shift-1',
      actor,
      {
        id: 'terminal-1',
        branch_id: 'branch-1',
        last_sale_sequence: 4n,
      },
    );

    expect(tickets.issue).toHaveBeenCalledWith({
      user_id: actor.sub,
      role: 'cashier',
      branch_id: 'branch-1',
      terminal_id: 'terminal-1',
      shift_id: 'shift-1',
      server_last_sale_sequence: 4n,
    });
    expect(result).toEqual({ token: 'signed' });
  });
});
