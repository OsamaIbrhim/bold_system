import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';

describe('ReportsService financial precision', () => {
  it('aggregates sales, refunds, tax, and cost without floating drift', async () => {
    const prisma = {
      salesInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            total: new Prisma.Decimal('0.10'),
            subtotal: new Prisma.Decimal('0.07'),
            tax_amount: new Prisma.Decimal('0.03'),
            items: [
              {
                unit_cost: new Prisma.Decimal('0.01'),
                qty: 3,
              },
            ],
          },
          {
            total: new Prisma.Decimal('0.20'),
            subtotal: new Prisma.Decimal('0.18'),
            tax_amount: new Prisma.Decimal('0.02'),
            items: [
              {
                unit_cost: new Prisma.Decimal('0.02'),
                qty: 2,
              },
            ],
          },
        ]),
      },
      return: {
        findMany: jest.fn().mockResolvedValue([
          {
            refund_total: new Prisma.Decimal('0.10'),
            refund_subtotal: new Prisma.Decimal('0.07'),
            refund_tax: new Prisma.Decimal('0.03'),
            items: [
              {
                unit_cost: new Prisma.Decimal('0.01'),
                qty: 1,
              },
            ],
          },
        ]),
      },
    };
    const service = new ReportsService(prisma as any);

    const report = await service.sales(
      '2026-07-01',
      '2026-07-01',
    );

    expect(report).toMatchObject({
      gross_sales: 0.3,
      refunds: 0.1,
      total_sales: 0.2,
      net_revenue: 0.18,
      total_tax: 0.02,
      total_cost: 0.06,
      profit: 0.12,
    });
  });
});
