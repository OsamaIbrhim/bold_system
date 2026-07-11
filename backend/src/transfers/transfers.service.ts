import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}
  list(branch_id?: string) {
    return this.prisma.transfer.findMany({
      where: branch_id ? { OR: [{ from_branch_id: branch_id }, { to_branch_id: branch_id }] } : {},
      orderBy: { created_at: 'desc' },
      take: 50
    });
  }
  get(id: string) {
    return this.prisma.transfer.findUnique({
      where: { id },
      include: { items: { include: { variant: { include: { product: true }}}}}
    });
  }
  async create(dto: any) {
    const number = 'TR-' + Date.now();
    return this.prisma.transfer.create({ 
      data: {
        from_branch_id: dto.from_branch_id,
        to_branch_id: dto.to_branch_id,
        transfer_number: number,
        created_by: dto.created_by,
        status: 'pending',
        items: dto.items && dto.items.length ? { create: dto.items.map((it:any)=>({ variant_id: it.variant_id, qty: it.qty })) } : undefined
      },
      include: { items: true }
    });
  }
  async ship(id: string) {
    return this.prisma.transfer.update({ where: { id }, data: { status: 'shipped' }});
  }
  async receive(id: string, items?: { variant_id: string, qty: number }[]) {
    const tr = await this.prisma.transfer.findUnique({ 
      where: { id },
      include: { items: true }
    });
    if (!tr) throw new BadRequestException('Transfer not found');
    if (tr.status === 'received') throw new BadRequestException('Already received');
    const transferItems = items && items.length ? items : tr.items.map(i => ({ variant_id: i.variant_id, qty: i.qty }));
    for (const it of transferItems) {
      await this.prisma.inventoryStock.upsert({
        where: { branch_id_variant_id: { branch_id: tr.from_branch_id, variant_id: it.variant_id }},
        update: { qty_on_hand: { decrement: it.qty }},
        create: { branch_id: tr.from_branch_id, variant_id: it.variant_id, qty_on_hand: -it.qty }
      });
      await this.prisma.inventoryStock.upsert({
        where: { branch_id_variant_id: { branch_id: tr.to_branch_id, variant_id: it.variant_id }},
        update: { qty_on_hand: { increment: it.qty }},
        create: { branch_id: tr.to_branch_id, variant_id: it.variant_id, qty_on_hand: it.qty }
      });
    }
    return this.prisma.transfer.update({ where: { id }, data: { status: 'received' }});
  }
}
