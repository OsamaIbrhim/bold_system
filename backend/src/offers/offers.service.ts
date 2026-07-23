import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { decimal, moneyNumber } from '../common/money';
import { Prisma } from '@prisma/client';

@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService, private pricing: PricingService) {}

  async suggestions(branch_id?: string) {
    const cutoff = new Date(Date.now() - 90 * 86400000);
    const slow = await this.prisma.inventoryStock.findMany({
      where: {
        OR: [{ last_sold_at: { lt: cutoff } }, { last_sold_at: null }],
        qty_on_hand: { gt: 0 },
        ...(branch_id ? { branch_id } : {}),
      },
    });
    const pending = await this.prisma.offerSuggestion.findMany({
      where: {
        status: 'pending',
        ...(branch_id ? { branch_id } : {}),
      },
    });
    const pendingByStock = new Map(pending.map((item) => [`${item.branch_id}:${item.variant_id}`, item]));

    for (const stock of slow) {
      const key = `${stock.branch_id}:${stock.variant_id}`;
      if (pendingByStock.has(key)) continue;
      const quote = await this.pricing.calculate(stock.variant_id);
      const currentPrice = quote.selling_price;
      const suggestedPrice = moneyNumber(
        Prisma.Decimal.max(
          decimal(quote.min_allowed_price),
          decimal(currentPrice).mul('0.90'),
        ),
      );
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const existing = await tx.offerSuggestion.findFirst({
          where: { branch_id: stock.branch_id, variant_id: stock.variant_id, status: 'pending' },
        });
        if (existing) return existing;
        return tx.offerSuggestion.create({
          data: {
            variant_id: stock.variant_id,
            branch_id: stock.branch_id,
            days_unsold: stock.last_sold_at
              ? Math.floor((Date.now() - stock.last_sold_at.getTime()) / 86400000)
              : 999,
            current_price: currentPrice,
            suggested_price: suggestedPrice,
            min_allowed_price: quote.min_allowed_price,
          },
        });
      });
      pendingByStock.set(key, created);
    }

    const qtyByStock = new Map(slow.map((stock) => [`${stock.branch_id}:${stock.variant_id}`, stock.qty_on_hand]));
    return [...pendingByStock.values()].map((item) => ({
      ...item,
      qty: qtyByStock.get(`${item.branch_id}:${item.variant_id}`) || 0,
    }));
  }

  async review(id: string, status: 'approved' | 'rejected', actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const suggestion = await tx.offerSuggestion.findUnique({ where: { id } });
      if (!suggestion) throw new NotFoundException('Offer suggestion not found');
      assertBranchAccess(actor, suggestion.branch_id);
      const changed = await tx.offerSuggestion.updateMany({
        where: { id, status: 'pending' },
        data: { status, reviewed_by: actor.sub },
      });
      if (changed.count !== 1) throw new ConflictException('Offer suggestion was already reviewed');
      await tx.auditLog.create({
        data: {
          user_id: actor.sub,
          action: `offer.${status}`,
          entity: 'OfferSuggestion',
          entity_id: id,
          meta: { branch_id: suggestion.branch_id, suggested_price: suggestion.suggested_price },
        },
      });
      return tx.offerSuggestion.findUnique({ where: { id } });
    });
  }
}
