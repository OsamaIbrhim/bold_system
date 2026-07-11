import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}
  // Create sale – idempotent via sync_id for offline POS
  async createSale(dto: any) {
    if (dto.sync_id) {
      const existing = await this.prisma.salesInvoice.findUnique({ where: { sync_id: dto.sync_id } });
      if (existing) return existing;
    }
    const invoice_number = 'B' + Date.now();
    const items = dto.items || [];
    let subtotal = 0;
    for (const it of items) subtotal += Number(it.unit_price) * it.qty;
    const tax_amount = subtotal * 0.14;
    const total = subtotal + tax_amount;
    const invoice = await this.prisma.salesInvoice.create({
      data: {
        invoice_number,
        branch_id: dto.branch_id,
        customer_id: dto.customer_id,
        cashier_id: dto.cashier_id,
        subtotal, tax_amount, total,
        payment_method: dto.payment_method || 'cash',
        language: dto.language || 'ar',
        sync_id: dto.sync_id,
        items: { create: items.map((it:any)=>({
          variant_id: it.variant_id, qty: it.qty,
          unit_price: it.unit_price, unit_cost: it.unit_cost || 0
        }))}
      },
      include: { items: true }
    });
    // decrement stock
    for (const it of items) {
      await this.prisma.inventoryStock.upsert({
        where: { branch_id_variant_id: { branch_id: dto.branch_id, variant_id: it.variant_id }},
        update: { qty_on_hand: { decrement: it.qty }, last_sold_at: new Date() },
        create: { branch_id: dto.branch_id, variant_id: it.variant_id, qty_on_hand: -it.qty }
      });
    }
    return invoice;
  }
  async createReturn(original_invoice_id: string, items: any[], created_by: string) {
    const original = await this.prisma.salesInvoice.findUnique({ where: { id: original_invoice_id }, include: { items: true }});
    if (!original) throw new Error('Original invoice not found');
    // check 14-day window
    const ageDays = (Date.now() - new Date(original.created_at).getTime()) / 86400000;
    if (ageDays > 14) throw new Error('Return window expired (14 days)');
    const return_number = 'R' + Date.now();
    const ret = await this.prisma.return.create({
      data: {
        original_invoice_id,
        return_invoice_number: return_number,
        is_partial: true,
        created_by
      }
    });
    // restock + increment return_count
    for (const it of items) {
      const inv = await this.prisma.inventoryStock.findUnique({
        where: { branch_id_variant_id: { branch_id: original.branch_id, variant_id: it.variant_id }}
      });
      if (inv) {
        await this.prisma.inventoryStock.update({
          where: { branch_id_variant_id: { branch_id: original.branch_id, variant_id: it.variant_id }},
          data: { qty_on_hand: { increment: it.qty }}
        });
      }
      await this.prisma.productVariant.update({
        where: { id: it.variant_id },
        data: { return_count: { increment: 1 }}
      });
    }
    // QA flag if return_count >= threshold (default 3)
    await this.prisma.productVariant.updateMany({
      where: { return_count: { gte: 3 } },
      data: { qa_flag: true }
    });
    return ret;
  }
}
