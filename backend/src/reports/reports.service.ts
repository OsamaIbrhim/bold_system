import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    const start = new Date(from);
    const endExclusive = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
      throw new BadRequestException('Invalid report date range');
    }
    // Date inputs represent inclusive business days. Query using a half-open
    // interval so the selected final day is not truncated at midnight.
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    } else {
      endExclusive.setMilliseconds(endExclusive.getMilliseconds() + 1);
    }
    return { gte: start, lt: endExclusive };
  }

  async sales(from: string, to: string, branch_id?: string) {
    const where:any = { status: 'completed', created_at: this.dateRange(from, to) };
    if (branch_id) where.branch_id = branch_id;
    const invoices = await this.prisma.salesInvoice.findMany({ where, include: { items: true }});
    const returnWhere:any = { status: 'completed', created_at: this.dateRange(from, to) };
    if (branch_id) returnWhere.branch_id = branch_id;
    const returns = await this.prisma.return.findMany({ where: returnWhere, include: { items: true } });

    const grossSales = invoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
    const netRevenueBeforeRefunds = invoices.reduce((sum, invoice) => sum + Number(invoice.subtotal), 0);
    const taxCollected = invoices.reduce((sum, invoice) => sum + Number(invoice.tax_amount), 0);
    const soldCost = invoices.flatMap((invoice) => invoice.items)
      .reduce((sum, item) => sum + Number(item.unit_cost) * item.qty, 0);
    const refundTotal = returns.reduce((sum, record) => sum + Number(record.refund_total), 0);
    const refundSubtotal = returns.reduce((sum, record) => sum + Number(record.refund_subtotal), 0);
    const refundTax = returns.reduce((sum, record) => sum + Number(record.refund_tax), 0);
    const returnedCost = returns.flatMap((record) => record.items)
      .reduce((sum, item) => sum + Number(item.unit_cost) * item.qty, 0);

    const totalSales = Math.round((grossSales - refundTotal) * 100) / 100;
    const totalCost = Math.round((soldCost - returnedCost) * 100) / 100;
    const netRevenue = Math.round((netRevenueBeforeRefunds - refundSubtotal) * 100) / 100;
    const totalTax = Math.round((taxCollected - refundTax) * 100) / 100;
    const profit = Math.round((netRevenue - totalCost) * 100) / 100;
    return {
      count: invoices.length,
      return_count: returns.length,
      gross_sales: grossSales,
      refunds: refundTotal,
      total_sales: totalSales,
      net_revenue: netRevenue,
      total_tax: totalTax,
      total_cost: totalCost,
      profit,
      invoices,
      returns,
    };
  }
  async bestSellers(branch_id?: string, limit = 20) {
    const items = await this.prisma.salesInvoiceItem.findMany({
      where: {
        invoice: {
          status: 'completed',
          ...(branch_id ? { branch_id } : {}),
        },
      },
      include: { 
        variant: { include: { product: true }}
      }});
    const returnedItems = await this.prisma.returnItem.findMany({
      where: {
        return_record: {
          status: 'completed',
          ...(branch_id ? { branch_id } : {}),
        },
      },
      include: { variant: { include: { product: true } } },
    });
    const map = new Map<string, {qty:number, name:string, profit:number}>();
    for (const it of items) {
      const key = it.variant_id;
      const prev = map.get(key) || { qty:0, name: it.variant?.product?.name_en || key, profit:0 };
      const profit = (Number(it.unit_price) - Number(it.unit_cost)) * it.qty;
      map.set(key, { qty: prev.qty + it.qty, name: prev.name, profit: prev.profit + profit });
    }
    for (const it of returnedItems) {
      const key = it.variant_id;
      const prev = map.get(key) || { qty:0, name: it.variant?.product?.name_en || key, profit:0 };
      const profit = (Number(it.unit_price) - Number(it.unit_cost)) * it.qty;
      map.set(key, { qty: prev.qty - it.qty, name: prev.name, profit: prev.profit - profit });
    }
    return [...map.entries()].map(([variant_id, v])=>({ variant_id, ...v }))
      .filter((item) => item.qty > 0)
      .sort((a,b)=>b.qty-a.qty).slice(0, limit);
  }
  async profitByItem(from: string, to: string, branch_id?: string) {
    // Profit per product variant
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { 
        status: 'completed',
        created_at: this.dateRange(from, to),
        ...(branch_id ? { branch_id } : {})
      },
      include: { items: { include: { variant: { include: { product: true }}}}}
    });
    const returnedItems = await this.prisma.returnItem.findMany({
      where: {
        return_record: {
          status: 'completed',
          created_at: this.dateRange(from, to),
          ...(branch_id ? { branch_id } : {}),
        },
      },
      include: { variant: { include: { product: true } } },
    });
    const map = new Map();
    for (const inv of invoices) {
      for (const it of inv.items) {
        const key = it.variant_id;
        const name = it.variant?.product?.name_en + ' ' + [it.variant?.size, it.variant?.color].filter(Boolean).join('/');
        const revenue = Number(it.unit_price) * it.qty;
        const cost = Number(it.unit_cost) * it.qty;
        const prev = map.get(key) || { variant_id: key, name, qty:0, revenue:0, cost:0, profit:0 };
        map.set(key, {
          variant_id: key, name,
          qty: prev.qty + it.qty,
          revenue: prev.revenue + revenue,
          cost: prev.cost + cost,
          profit: prev.profit + revenue - cost
        });
      }
    }
    for (const it of returnedItems) {
      const key = it.variant_id;
      const name = it.variant?.product?.name_en + ' ' + [it.variant?.size, it.variant?.color].filter(Boolean).join('/');
      const revenue = Number(it.unit_price) * it.qty;
      const cost = Number(it.unit_cost) * it.qty;
      const prev = map.get(key) || { variant_id: key, name, qty:0, revenue:0, cost:0, profit:0 };
      map.set(key, {
        variant_id: key, name,
        qty: prev.qty - it.qty,
        revenue: prev.revenue - revenue,
        cost: prev.cost - cost,
        profit: prev.profit - revenue + cost,
      });
    }
    return Array.from(map.values()).sort((a,b)=>b.profit-a.profit);
  }
  async inventoryValuation(branch_id?: string) {
    const stock = await this.prisma.inventoryStock.findMany({
      where: branch_id ? { branch_id, qty_on_hand: { gt: 0 }} : { qty_on_hand: { gt: 0 }},
      include: { 
        variant: { include: { product: true }},
        branch: true
      }
    });
    const rows = stock.map(s => ({
      branch: s.branch.name_ar,
      sku: s.variant.sku,
      product: s.variant.product.name_en,
      size: s.variant.size,
      color: s.variant.color,
      qty: s.qty_on_hand,
      cost_price: Number(s.variant.cost_price),
      value: s.qty_on_hand * Number(s.variant.cost_price)
    }));
    const total_value = rows.reduce((sum,r)=> sum + r.value, 0);
    const total_qty = rows.reduce((sum,r)=> sum + r.qty, 0);
    return { total_qty, total_value, rows };
  }
}
