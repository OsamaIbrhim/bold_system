import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async open(branch_id: string, actor: AuthenticatedUser, opening_cash = 0) {
    assertBranchAccess(actor, branch_id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${branch_id}))`;
      const branch = await tx.branch.findFirst({ where: { id: branch_id, is_active: true }, select: { id: true } });
      if (!branch) throw new NotFoundException('Active branch not found');
      const existing = await tx.shift.findFirst({ where: { branch_id, status: 'open' } });
      if (existing) return existing;
      return tx.shift.create({
        data: { branch_id, opened_by: actor.sub, opening_cash, status: 'open' },
      });
    });
  }

  async close(id: string, actor: AuthenticatedUser, closing_cash: number) {
    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('Shift not found');
      assertBranchAccess(actor, shift.branch_id);
      if (shift.status !== 'open') throw new ConflictException('Shift is not open');

      const closedAt = new Date();
      const [cashSales, cashReturns] = await Promise.all([
        tx.salesInvoice.aggregate({
          where: {
            branch_id: shift.branch_id,
            status: 'completed',
            payment_method: 'cash',
            created_at: { gte: shift.opened_at, lt: closedAt },
          },
          _sum: { total: true },
        }),
        tx.return.aggregate({
          where: {
            branch_id: shift.branch_id,
            status: 'completed',
            created_at: { gte: shift.opened_at, lt: closedAt },
            original_invoice: { payment_method: 'cash' },
          },
          _sum: { refund_total: true },
        }),
      ]);
      const expectedCash = new Prisma.Decimal(shift.opening_cash)
        .plus(cashSales._sum.total || 0)
        .minus(cashReturns._sum.refund_total || 0)
        .toDecimalPlaces(2);
      const difference = new Prisma.Decimal(closing_cash).minus(expectedCash).toDecimalPlaces(2);

      const changed = await tx.shift.updateMany({
        where: { id, status: 'open' },
        data: {
          closed_by: actor.sub,
          closing_cash,
          expected_cash: expectedCash,
          difference,
          closed_at: closedAt,
          status: 'closed',
        },
      });
      if (changed.count !== 1) throw new ConflictException('Shift was already closed');
      return tx.shift.findUnique({ where: { id } });
    });
  }

  list(branch_id?: string) {
    return this.prisma.shift.findMany({
      where: branch_id ? { branch_id } : {},
      orderBy: { opened_at: 'desc' },
      take: 50,
    });
  }

  current(branch_id: string) {
    return this.prisma.shift.findFirst({ where: { branch_id, status: 'open' } });
  }
}
