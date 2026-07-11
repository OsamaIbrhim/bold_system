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
  async bestSellers(branch_id?: string) {
    const items = await this.prisma.salesInvoiceItem.findMany({ include: { invoice: true }});
    const map = new Map();
    for (const it of items) {
      if (branch_id && it.invoice.branch_id !== branch_id) continue;
      map.set(it.variant_id, (map.get(it.variant_id)||0) + it.qty);
    }
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20);
  }
}
