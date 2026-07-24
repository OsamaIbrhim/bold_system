import { SellersService } from './sellers.service';

describe('SellersService', () => {
  it('subtracts in-period returns from pre-tax seller sales', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([
        { id: 'seller-1', name: 'Seller', branch_id: 'branch-1', is_active: true, branch: null, seller_commission_override: null },
      ]) },
      salesInvoice: { findMany: jest.fn().mockResolvedValue([
        { seller_id: 'seller-1', subtotal: 1000 },
        { seller_id: 'seller-1', subtotal: 500 },
      ]) },
      return: { findMany: jest.fn().mockResolvedValue([
        { refund_subtotal: 200, original_invoice: { seller_id: 'seller-1' } },
      ]) },
      sellerCommissionSettings: { upsert: jest.fn().mockResolvedValue({
        id: 1,
        default_rate: 2,
        default_target: 1000,
        default_bonus: 100,
        period_length_days: 30,
        period_anchor: new Date('2026-07-01'),
      }) },
    };
    const result = await new SellersService(prisma as any).report(
      '2026-07-01',
      '2026-07-31',
      'branch-1',
    );
    expect(result.rows[0]).toMatchObject({
      invoice_count: 2,
      gross_sales_before_tax: 1500,
      return_count: 1,
      returns_before_tax: 200,
      net_sales_before_tax: 1300,
      commission_rate: 2,
      percentage_commission: 26,
      target_achieved: true,
      target_bonus: 100,
      estimated_total: 126,
    });
  });

  it('stores an immutable row and settings snapshot when closing a completed period', async () => {
    const create = jest.fn().mockImplementation(({ data }) => ({ id: 'period-1', ...data }));
    const prisma = {
      sellerCommissionPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const service = new SellersService(prisma as any);
    jest.spyOn(service as any, 'getSettings').mockResolvedValue({
      default_rate: 3,
      default_target: 1000,
      default_bonus: 200,
      period_length_days: 30,
    });
    jest.spyOn(service, 'report').mockResolvedValue({
      from: '2026-06-01',
      to: '2026-06-30',
      branch_id: null,
      seller_id: null,
      rows: [{
        seller: {
          id: 'seller-1',
          name: 'Historical name',
          branch_id: 'branch-1',
          branch: { name_ar: 'Main' },
        },
        invoice_count: 2,
        gross_sales_before_tax: 1200,
        return_count: 1,
        returns_before_tax: 200,
        net_sales_before_tax: 1000,
        commission_rate: 3,
        percentage_commission: 30,
        target: 1000,
        target_achieved: true,
        target_bonus: 200,
        estimated_total: 230,
      }],
    } as any);

    await service.closePeriod(
      '2026-06-01',
      '2026-06-30',
      { sub: 'owner-1', role: 'owner', branch_id: null } as any,
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        default_rate: 3,
        period_length_days: 30,
        rows: {
          create: [expect.objectContaining({
            seller_name: 'Historical name',
            net_sales_before_tax: 1000,
            commission_rate: 3,
            estimated_total: 230,
          })],
        },
      }),
    }));
  });
});
