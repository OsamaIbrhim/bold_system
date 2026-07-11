import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService) {}
  async suggestions(branch_id?: string) {
    // slow stock = last_sold_at > 90 days or never sold
    const cutoff = new Date(Date.now() - 90*86400000);
    const where:any = { OR: [{ last_sold_at: { lt: cutoff } }, { last_sold_at: null }], qty_on_hand: { gt: 0 } };
    if (branch_id) where.branch_id = branch_id;
    const slow = await this.prisma.inventoryStock.findMany({ where, include: { variant: true }});
    return slow.map(s => ({
      variant_id: s.variant_id,
      branch_id: s.branch_id,
      days_unsold: s.last_sold_at ? Math.floor((Date.now()-new Date(s.last_sold_at).getTime())/86400000) : 999,
      qty: s.qty_on_hand
    }));
  }
  async review(id: string, status: 'approved'|'rejected', reviewed_by: string) {
    return this.prisma.offerSuggestion.update({ where: { id }, data: { status, reviewed_by }});
  }
}
