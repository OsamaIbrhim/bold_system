import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { money, moneyNumber } from '../common/money';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  UpdateCommissionSettingsDto,
  UpdateSellerCommissionDto,
} from './dto/commission-settings.dto';

@Injectable()
export class SellersService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid seller report date range');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      end.setUTCDate(end.getUTCDate() + 1);
    } else {
      end.setMilliseconds(end.getMilliseconds() + 1);
    }
    if (start >= end) {
      throw new BadRequestException('Report start must be before report end');
    }
    return { gte: start, lt: end };
  }

  private periodBounds(from: string, to: string) {
    const range = this.dateRange(from, to);
    return { start: range.gte, endExclusive: range.lt };
  }

  async report(
    from: string,
    to: string,
    branchId?: string,
    sellerId?: string,
  ) {
    const range = this.dateRange(from, to);
    const sellerWhere = {
      role: 'seller' as const,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(sellerId ? { id: sellerId } : {}),
    };
    const [sellers, sales, returns, settings] = await Promise.all([
      this.prisma.user.findMany({
        where: sellerWhere,
        select: {
          id: true, name: true, branch_id: true, is_active: true,
          branch: { select: { id: true, code: true, name_ar: true } },
          seller_commission_override: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.salesInvoice.findMany({
        where: {
          status: 'completed',
          occurred_at: range,
          seller_id: { not: null },
          ...(branchId ? { branch_id: branchId } : {}),
          ...(sellerId ? { seller_id: sellerId } : {}),
        },
        select: { seller_id: true, subtotal: true },
      }),
      this.prisma.return.findMany({
        where: {
          status: 'completed',
          created_at: range,
          original_invoice: {
            seller_id: { not: null },
            ...(sellerId ? { seller_id: sellerId } : {}),
          },
          ...(branchId ? { branch_id: branchId } : {}),
        },
        select: {
          refund_subtotal: true,
          original_invoice: { select: { seller_id: true } },
        },
      }),
      this.getSettings(),
    ]);

    const rows = new Map<string, {
      invoiceCount: number;
      gross: Prisma.Decimal;
      returnCount: number;
      refunds: Prisma.Decimal;
    }>();
    for (const seller of sellers) {
      rows.set(seller.id, {
        invoiceCount: 0,
        gross: new Prisma.Decimal(0),
        returnCount: 0,
        refunds: new Prisma.Decimal(0),
      });
    }
    for (const invoice of sales) {
      if (!invoice.seller_id || !rows.has(invoice.seller_id)) continue;
      const row = rows.get(invoice.seller_id)!;
      row.invoiceCount += 1;
      row.gross = row.gross.plus(invoice.subtotal);
    }
    for (const record of returns) {
      const id = record.original_invoice.seller_id;
      if (!id || !rows.has(id)) continue;
      const row = rows.get(id)!;
      row.returnCount += 1;
      row.refunds = row.refunds.plus(record.refund_subtotal);
    }

    return {
      from,
      to,
      branch_id: branchId || null,
      seller_id: sellerId || null,
      rows: sellers.map((seller) => {
        const value = rows.get(seller.id)!;
        const override = seller.seller_commission_override;
        const rate = new Prisma.Decimal(override?.rate ?? settings.default_rate);
        const target = override?.target ?? settings.default_target;
        const bonus = new Prisma.Decimal(override?.bonus ?? settings.default_bonus);
        const net = money(value.gross.minus(value.refunds));
        const percentageCommission = money(net.mul(rate).div(100));
        const targetAchieved = target !== null && net.gte(target);
        const targetBonus = targetAchieved ? money(bonus) : money(0);
        return {
          seller,
          invoice_count: value.invoiceCount,
          gross_sales_before_tax: moneyNumber(value.gross),
          return_count: value.returnCount,
          returns_before_tax: moneyNumber(value.refunds),
          net_sales_before_tax: moneyNumber(net),
          commission_rate: Number(rate.toFixed(2)),
          percentage_commission: moneyNumber(percentageCommission),
          target: target === null ? null : moneyNumber(target),
          target_achieved: targetAchieved,
          target_bonus: moneyNumber(targetBonus),
          estimated_total: moneyNumber(
            money(percentageCommission.plus(targetBonus)),
          ),
        };
      }),
    };
  }

  async settings(actor: AuthenticatedUser) {
    const settings = await this.getSettings();
    const overrides = await this.prisma.sellerCommissionOverride.findMany({
      where: actor.role === 'owner'
        ? {}
        : { seller: { branch_id: actor.branch_id || undefined } },
      include: { seller: { select: { id: true, name: true, branch_id: true } } },
      orderBy: { seller: { name: 'asc' } },
    });
    return { settings, overrides };
  }

  updateSettings(dto: UpdateCommissionSettingsDto, actor: AuthenticatedUser) {
    if (actor.role !== 'owner') throw new ForbiddenException('Only the owner can change commission defaults');
    return this.prisma.sellerCommissionSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ...dto,
        period_anchor: new Date(dto.period_anchor),
      },
      update: {
        ...dto,
        period_anchor: new Date(dto.period_anchor),
      },
    });
  }

  async updateSellerSettings(
    sellerId: string,
    dto: UpdateSellerCommissionDto,
    actor: AuthenticatedUser,
  ) {
    if (actor.role !== 'owner') throw new ForbiddenException('Only the owner can change seller commissions');
    const seller = await this.prisma.user.findFirst({
      where: { id: sellerId, role: 'seller' },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    return this.prisma.sellerCommissionOverride.upsert({
      where: { seller_id: sellerId },
      create: { seller_id: sellerId, ...dto },
      update: dto,
    });
  }

  private getSettings() {
    return this.prisma.sellerCommissionSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  periods(actor: AuthenticatedUser) {
    return this.prisma.sellerCommissionPeriod.findMany({
      where: actor.role === 'owner'
        ? {}
        : { rows: { some: { branch_id: actor.branch_id || undefined } } },
      include: {
        closer: { select: { id: true, name: true } },
        rows: {
          where: actor.role === 'owner'
            ? {}
            : { branch_id: actor.branch_id || undefined },
          orderBy: [{ seller_name: 'asc' }, { seller_id: 'asc' }],
        },
      },
      orderBy: { closed_at: 'desc' },
      take: 24,
    });
  }

  async closePeriod(
    from: string,
    to: string,
    actor: AuthenticatedUser,
  ) {
    if (actor.role !== 'owner') {
      throw new ForbiddenException('Only the owner can close seller periods');
    }
    const { start, endExclusive } = this.periodBounds(from, to);
    if (endExclusive > new Date()) {
      throw new BadRequestException('Only a completed period can be closed');
    }
    const existing = await this.prisma.sellerCommissionPeriod.findUnique({
      where: {
        period_start_period_end_exclusive: {
          period_start: start,
          period_end_exclusive: endExclusive,
        },
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('This seller period is already closed');

    const [settings, report] = await Promise.all([
      this.getSettings(),
      this.report(from, to),
    ]);
    const period = await this.prisma.sellerCommissionPeriod.create({
      data: {
        period_start: start,
        period_end_exclusive: endExclusive,
        period_length_days: settings.period_length_days,
        default_rate: settings.default_rate,
        default_target: settings.default_target,
        default_bonus: settings.default_bonus,
        closed_by: actor.sub,
        rows: {
          create: report.rows.map((row) => ({
            seller_id: row.seller.id,
            seller_name: row.seller.name,
            branch_id: row.seller.branch_id,
            branch_name: row.seller.branch?.name_ar || null,
            invoice_count: row.invoice_count,
            gross_sales_before_tax: row.gross_sales_before_tax,
            return_count: row.return_count,
            returns_before_tax: row.returns_before_tax,
            net_sales_before_tax: row.net_sales_before_tax,
            commission_rate: row.commission_rate,
            percentage_commission: row.percentage_commission,
            target: row.target,
            target_achieved: row.target_achieved,
            target_bonus: row.target_bonus,
            estimated_total: row.estimated_total,
          })),
        },
      },
      include: { rows: true },
    });
    return period;
  }
}
