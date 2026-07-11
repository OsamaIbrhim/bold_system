import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}
  async lookup(variantId: string) {
    const stock = await this.prisma.inventoryStock.findMany({
      where: { variant_id: variantId, qty_on_hand: { gt: 0 } },
      include: { branch: true }
    });
    return stock;
  }
}
