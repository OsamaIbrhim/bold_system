import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

type PriceableVariant = {
  id: string;
  product_id: string;
  cost_price: Prisma.Decimal | number | string;
  product: { category_id?: string | null; brand?: string | null };
};

export type PriceRule = {
  scope_type: string;
  scope_id: string | null;
  overhead_percent: Prisma.Decimal | number | string;
  profit_percent: Prisma.Decimal | number | string;
  tax_percent: Prisma.Decimal | number | string;
};

export type PriceQuote = {
  cost: number;
  overhead_percent: number;
  profit_percent: number;
  tax_percent: number;
  net_price: number;
  tax_amount: number;
  selling_price: number;
  min_allowed_price: number;
  breakdown: {
    price_after_overhead: number;
    price_after_profit: number;
    price_after_tax: number;
  };
};

/**
 * Bold Pricing Engine
 * compound: Price = cost * (1+overhead) * (1+profit) * (1+tax)
 * Rules priority: variant > product > brand > category > global
 */
@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  async calculate(variantId: string, transaction?: Prisma.TransactionClient) {
    const db = transaction || this.prisma;
    const [variant, rules] = await Promise.all([
      db.productVariant.findUnique({
        where: { id: variantId },
        include: { product: true },
      }),
      db.pricingRule.findMany({ where: { is_active: true }, orderBy: { priority: 'asc' } }),
    ]);
    if (!variant) throw new NotFoundException('Variant not found');
    return this.quote(variant, rules);
  }

  /** Calculate many prices after one rule query, avoiding the old 2N query pattern. */
  async calculateMany(
    variants: PriceableVariant[],
    transaction?: Prisma.TransactionClient,
  ): Promise<Map<string, PriceQuote>> {
    const rules = await this.loadActiveRules(transaction);
    return this.quoteMany(variants, rules);
  }

  async loadActiveRules(transaction?: Prisma.TransactionClient): Promise<PriceRule[]> {
    const db = transaction || this.prisma;
    return db.pricingRule.findMany({
      where: { is_active: true },
      orderBy: { priority: 'asc' },
    });
  }

  quoteMany(variants: PriceableVariant[], rules: PriceRule[]) {
    return new Map(variants.map((variant) => [variant.id, this.quote(variant, rules)]));
  }

  quote(variant: PriceableVariant, rules: PriceRule[]): PriceQuote {
    const rule = rules.find((item) => item.scope_type === 'variant' && item.scope_id === variant.id)
      || rules.find((item) => item.scope_type === 'product' && item.scope_id === variant.product_id)
      || rules.find((item) => item.scope_type === 'brand' && !!variant.product.brand && item.scope_id === variant.product.brand)
      || rules.find((item) => item.scope_type === 'category' && !!variant.product.category_id && item.scope_id === variant.product.category_id)
      || rules.find((item) => item.scope_type === 'global')
      || { overhead_percent: 20, profit_percent: 35, tax_percent: 14, scope_type: 'global', scope_id: null };

    const cost = new Prisma.Decimal(variant.cost_price);
    const hundred = new Prisma.Decimal(100);
    const factor = (percentage: Prisma.Decimal | number | string) =>
      new Prisma.Decimal(1).plus(new Prisma.Decimal(percentage).div(hundred));
    const priceAfterOverhead = cost.mul(factor(rule.overhead_percent));
    const priceAfterProfit = priceAfterOverhead.mul(factor(rule.profit_percent));
    const priceAfterTax = priceAfterProfit.mul(factor(rule.tax_percent));
    const netPrice = priceAfterProfit.toDecimalPlaces(2);
    const sellingPrice = priceAfterTax.toDecimalPlaces(2);
    // Derive tax from the two rounded boundary values so net + tax always
    // equals the persisted/displayed total to the cent.
    const taxAmount = sellingPrice.minus(netPrice).toDecimalPlaces(2);
    const minimum = priceAfterOverhead.mul(factor(rule.tax_percent)).toDecimalPlaces(2);

    return {
      cost: cost.toNumber(),
      overhead_percent: new Prisma.Decimal(rule.overhead_percent).toNumber(),
      profit_percent: new Prisma.Decimal(rule.profit_percent).toNumber(),
      tax_percent: new Prisma.Decimal(rule.tax_percent).toNumber(),
      net_price: netPrice.toNumber(),
      tax_amount: taxAmount.toNumber(),
      selling_price: sellingPrice.toNumber(),
      min_allowed_price: minimum.toNumber(),
      breakdown: {
        price_after_overhead: priceAfterOverhead.toNumber(),
        price_after_profit: priceAfterProfit.toNumber(),
        price_after_tax: priceAfterTax.toNumber(),
      },
    };
  }
}
