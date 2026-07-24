import { ROLES_KEY } from '../auth/roles.guard';
import { ReportsController } from './reports.controller';

describe('ReportsController authorization', () => {
  const warehouseManager = {
    sub: 'warehouse-1',
    role: 'warehouse_manager' as const,
    branch_id: null,
  };
  const branchManager = {
    sub: 'manager-1',
    role: 'branch_manager' as const,
    branch_id: 'branch-a',
  };

  function setup() {
    const reports = {
      sales: jest.fn().mockResolvedValue({ total_sales: 125 }),
      bestSellers: jest.fn(),
      profitByItem: jest.fn(),
      inventoryValuation: jest.fn(),
    };
    return {
      reports,
      controller: new ReportsController(reports as any, {} as any),
    };
  }

  it('allows warehouse managers to read every report without granting report sending', () => {
    const readMethods = [
      'sales',
      'best',
      'profitByItem',
      'inventoryValuation',
    ] as const;

    for (const method of readMethods) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          ReportsController.prototype[method],
        ),
      ).toContain('warehouse_manager');
    }

    expect(
      Reflect.getMetadata(ROLES_KEY, ReportsController),
    ).toEqual(['owner', 'branch_manager']);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        ReportsController.prototype.send,
      ),
    ).toBeUndefined();
  });

  it('lets a warehouse manager read all branches or select one branch', async () => {
    const { controller, reports } = setup();

    await controller.sales(
      '2026-07-24',
      '2026-07-24',
      undefined,
      { user: warehouseManager } as any,
    );
    await controller.sales(
      '2026-07-24',
      '2026-07-24',
      'branch-b',
      { user: warehouseManager } as any,
    );

    expect(reports.sales).toHaveBeenNthCalledWith(
      1,
      '2026-07-24',
      '2026-07-24',
      undefined,
    );
    expect(reports.sales).toHaveBeenNthCalledWith(
      2,
      '2026-07-24',
      '2026-07-24',
      'branch-b',
    );
  });

  it('keeps a branch manager report scoped to the assigned branch', async () => {
    const { controller, reports } = setup();

    await controller.sales(
      '2026-07-24',
      '2026-07-24',
      undefined,
      { user: branchManager } as any,
    );

    expect(reports.sales).toHaveBeenCalledWith(
      '2026-07-24',
      '2026-07-24',
      'branch-a',
    );
  });
});
