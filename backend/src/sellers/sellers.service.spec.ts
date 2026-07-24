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
});
