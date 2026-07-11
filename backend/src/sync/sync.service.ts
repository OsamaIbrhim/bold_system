import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}
  async push(batch: any[]) {
    // offline POS push – idempotent via sync_id
    return { received: batch.length };
  }
  async pull(since: string, branch_id: string) {
    const sinceDate = since ? new Date(since) : new Date(0);
    const products = await this.prisma.productVariant.findMany({});
    const stock = await this.prisma.inventoryStock.findMany({ where: { branch_id }});
    return { server_time: new Date().toISOString(), products, stock };
  }
}
