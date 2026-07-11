import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}
  async sales(from: string, to: string, branch_id?: string) {
    const where:any = { created_at: { gte: new Date(from), lte: new Date(to) } };
    if (branch_id) where.branch_id = branch_id;
    const invoices = await this.prisma.salesInvoice.findMany({ where, include: { items: true }});
    const total_sales = invoices.reduce((s,i)=> s + Number(i.total), 0);
    const total_cost = invoices.flatMap(i=>i.items).reduce((s,it)=> s + Number(it.unit_cost)*it.qty, 0);
    return { count: invoices.length, total_sales, total_cost, profit: total_sales - total_cost, invoices };
  }
  async bestSellers(branch_id?: string, limit = 20) {
    const items = await this.prisma.salesInvoiceItem.findMany({ 
      include: { 
        invoice: true,
        variant: { include: { product: true }}
      }});
    const map = new Map<string, {qty:number, name:string, profit:number}>();
    for (const it of items) {
      if (branch_id && it.invoice.branch_id !== branch_id) continue;
      const key = it.variant_id;
      const prev = map.get(key) || { qty:0, name: it.variant?.product?.name_en || key, profit:0 };
      const profit = (Number(it.unit_price) - Number(it.unit_cost)) * it.qty;
      map.set(key, { qty: prev.qty + it.qty, name: prev.name, profit: prev.profit + profit });
    }
    return [...map.entries()].map(([variant_id, v])=>({ variant_id, ...v }))
      .sort((a,b)=>b.qty-a.qty).slice(0, limit);
  }
  async profitByItem(from: string, to: string, branch_id?: string) {
    // Profit per product variant
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { 
        created_at: { gte: new Date(from), lte: new Date(to) },
        ...(branch_id ? { branch_id } : {})
      },
      include: { items: { include: { variant: { include: { product: true }}}}}
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
