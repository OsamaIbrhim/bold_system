import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { money, moneyNumber } from '../common/money';

@Injectable()
export class SellersService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid seller report date range');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      end.setUTCDate(end.getUTCDate() + 1);
    } else {
      end.setMilliseconds(end.getMilliseconds() + 1);
    }
    if (start >= end) {
      throw new BadRequestException('Report start must be before report end');
    }
    return { gte: start, lt: end };
  }

  async report(
    from: string,
    to: string,
    branchId?: string,
    sellerId?: string,
  ) {
    const range = this.dateRange(from, to);
    const sellerWhere = {
      role: 'seller' as const,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(sellerId ? { id: sellerId } : {}),
    };
    const [sellers, sales, returns] = await Promise.all([
      this.prisma.user.findMany({
        where: sellerWhere,
        select: {
          id: true, name: true, branch_id: true, is_active: true,
          branch: { select: { id: true, code: true, name_ar: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.salesInvoice.findMany({
        where: {
          status: 'completed',
          occurred_at: range,
          seller_id: { not: null },
          ...(branchId ? { branch_id: branchId } : {}),
          ...(sellerId ? { seller_id: sellerId } : {}),
        },
        select: { seller_id: true, subtotal: true },
      }),
      this.prisma.return.findMany({
        where: {
          status: 'completed',
          created_at: range,
          original_invoice: {
            seller_id: { not: null },
            ...(sellerId ? { seller_id: sellerId } : {}),
          },
          ...(branchId ? { branch_id: branchId } : {}),
        },
        select: {
          refund_subtotal: true,
          original_invoice: { select: { seller_id: true } },
        },
      }),
    ]);

    const rows = new Map<string, {
      invoiceCount: number;
      gross: Prisma.Decimal;
      returnCount: number;
      refunds: Prisma.Decimal;
    }>();
    for (const seller of sellers) {
      rows.set(seller.id, {
        invoiceCount: 0,
        gross: new Prisma.Decimal(0),
        returnCount: 0,
        refunds: new Prisma.Decimal(0),
      });
    }
    for (const invoice of sales) {
      if (!invoice.seller_id || !rows.has(invoice.seller_id)) continue;
      const row = rows.get(invoice.seller_id)!;
      row.invoiceCount += 1;
      row.gross = row.gross.plus(invoice.subtotal);
    }
    for (const record of returns) {
      const id = record.original_invoice.seller_id;
      if (!id || !rows.has(id)) continue;
      const row = rows.get(id)!;
      row.returnCount += 1;
      row.refunds = row.refunds.plus(record.refund_subtotal);
    }

    return {
      from,
      to,
      branch_id: branchId || null,
      seller_id: sellerId || null,
      rows: sellers.map((seller) => {
        const value = rows.get(seller.id)!;
        return {
          seller,
          invoice_count: value.invoiceCount,
          gross_sales_before_tax: moneyNumber(value.gross),
          return_count: value.returnCount,
          returns_before_tax: moneyNumber(value.refunds),
          net_sales_before_tax: moneyNumber(money(value.gross.minus(value.refunds))),
        };
      }),
    };
  }
}
