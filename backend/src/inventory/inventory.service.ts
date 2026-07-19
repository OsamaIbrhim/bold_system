import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}
  async lookup(variantId: string, branchId?: string) {
    const stock = await this.prisma.inventoryStock.findMany({
      where: {
        variant_id: variantId,
        qty_on_hand: { gt: 0 },
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: { branch: true }
    });
    return stock;
  }
}
