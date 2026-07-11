import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class PurchasingService {
  constructor(private prisma: PrismaService) {}
  list(branch_id?: string, take = 50) {
    return this.prisma.purchaseInvoice.findMany({
      where: branch_id ? { branch_id } : {},
      include: { supplier: true, items: { include: { variant: { include: { product: true }}}}},
      orderBy: { created_at: 'desc' },
      take
    });
  }
  get(id: string) {
    return this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { supplier: true, items: { include: { variant: { include: { product: true }}}}}
    });
  }
  async receive(dto: any) {
    const subtotal = dto.items.reduce((s:any,i:any)=> s + i.qty * i.unit_cost, 0);
    const discount = dto.discount_amount || subtotal * (dto.discount_percent||0)/100;
    const total = subtotal - discount;
    const inv = await this.prisma.purchaseInvoice.create({
      data: {
        supplier_id: dto.supplier_id,
        branch_id: dto.branch_id,
        invoice_number: dto.invoice_number,
        invoice_date: dto.invoice_date ? new Date(dto.invoice_date) : undefined,
        subtotal, discount_amount: discount,
        discount_percent: dto.discount_percent || 0,
        total,
        ocr_source_file: dto.ocr_source_file,
        created_by: dto.created_by,
        items: {
          create: dto.items.map((it:any)=>({
            variant_id: it.variant_id,
            qty: it.qty,
            unit_cost: it.unit_cost
          }))
        }
      },
      include: { items: true, supplier: true }
    });
    // increase stock
    for (const it of dto.items) {
      await this.prisma.inventoryStock.upsert({
        where: { branch_id_variant_id: { branch_id: dto.branch_id, variant_id: it.variant_id }},
        update: { qty_on_hand: { increment: it.qty }},
        create: { branch_id: dto.branch_id, variant_id: it.variant_id, qty_on_hand: it.qty }
      });
    }
    return inv;
  }
  async ocrImport(fileUrl: string) { return { draft: true, source: fileUrl, items: [], message: 'Upload supplier invoice – edit then confirm – supplier alias mapping supported' }; }
}
