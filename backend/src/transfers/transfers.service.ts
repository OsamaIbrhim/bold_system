import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransferDto } from './dto/transfer.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  list(branch_id?: string) {
    return this.prisma.transfer.findMany({
      where: branch_id ? { OR: [{ from_branch_id: branch_id }, { to_branch_id: branch_id }] } : {},
      include: { from_branch: true, to_branch: true, items: true },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async get(id: string, actor: AuthenticatedUser) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: {
        from_branch: true,
        to_branch: true,
        items: { include: { variant: { include: { product: true } } } },
      },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (actor.role !== 'owner' && actor.role !== 'warehouse_manager') {
      const isParticipant = actor.branch_id === transfer.from_branch_id || actor.branch_id === transfer.to_branch_id;
      if (!isParticipant) assertBranchAccess(actor, transfer.from_branch_id);
    }
    return transfer;
  }

  async create(dto: CreateTransferDto, actor: AuthenticatedUser) {
    if (dto.from_branch_id === dto.to_branch_id) {
      throw new BadRequestException('Source and destination branches must be different');
    }
    assertBranchAccess(actor, dto.from_branch_id, ['owner', 'warehouse_manager']);

    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(item.variant_id, (quantities.get(item.variant_id) || 0) + item.qty);
    }
    const items = [...quantities.entries()].map(([variant_id, qty]) => ({ variant_id, qty }));

    return this.prisma.$transaction(async (tx) => {
      const [branches, variantCount] = await Promise.all([
        tx.branch.count({
          where: { id: { in: [dto.from_branch_id, dto.to_branch_id] }, is_active: true },
        }),
        tx.productVariant.count({ where: { id: { in: items.map((item) => item.variant_id) } } }),
      ]);
      if (branches !== 2) throw new NotFoundException('One or more active branches were not found');
      if (variantCount !== items.length) throw new NotFoundException('One or more product variants were not found');

      return tx.transfer.create({
        data: {
          from_branch_id: dto.from_branch_id,
          to_branch_id: dto.to_branch_id,
          transfer_number: `TR-${Date.now()}-${randomUUID().slice(0, 8)}`,
          created_by: actor.sub,
          status: 'pending',
          items: { create: items },
        },
        include: { items: true, from_branch: true, to_branch: true },
      });
    });
  }

  async ship(id: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.findUnique({ where: { id }, include: { items: true } });
      if (!transfer) throw new NotFoundException('Transfer not found');
      assertBranchAccess(actor, transfer.from_branch_id, ['owner', 'warehouse_manager']);

      const claimed = await tx.transfer.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'shipped', shipped_by: actor.sub, shipped_at: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('Only a pending transfer can be shipped');

      for (const item of transfer.items) {
        const changed = await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "qty_on_hand" = "qty_on_hand" - ${item.qty}
          WHERE "branch_id" = ${transfer.from_branch_id}::uuid
            AND "variant_id" = ${item.variant_id}::uuid
            AND ("qty_on_hand" - "qty_reserved") >= ${item.qty}
        `;
        if (changed !== 1) {
          throw new ConflictException(`Insufficient available stock for variant ${item.variant_id}`);
        }
      }
      return tx.transfer.findUnique({ where: { id }, include: { items: true } });
    });
  }

  async receive(id: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.findUnique({ where: { id }, include: { items: true } });
      if (!transfer) throw new NotFoundException('Transfer not found');
      assertBranchAccess(actor, transfer.to_branch_id, ['owner', 'warehouse_manager']);

      const claimed = await tx.transfer.updateMany({
        where: { id, status: 'shipped' },
        data: { status: 'received', received_by: actor.sub, received_at: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('Only a shipped transfer can be received');

      for (const item of transfer.items) {
        await tx.inventoryStock.upsert({
          where: { branch_id_variant_id: { branch_id: transfer.to_branch_id, variant_id: item.variant_id } },
          update: { qty_on_hand: { increment: item.qty } },
          create: { branch_id: transfer.to_branch_id, variant_id: item.variant_id, qty_on_hand: item.qty },
        });
      }
      return tx.transfer.findUnique({ where: { id }, include: { items: true } });
    });
  }
}
