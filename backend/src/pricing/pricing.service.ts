import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
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
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true }
    });
    if (!variant) throw new NotFoundException('Variant not found');
    const cost = Number(variant.cost_price);
    // find best pricing rule
    const rules = await db.pricingRule.findMany({ where: { is_active: true }, orderBy: { priority: 'asc' }});
    let rule = rules.find(r => r.scope_type === 'variant' && r.scope_id === variantId)
      || rules.find(r => r.scope_type === 'product' && r.scope_id === variant.product_id)
      || rules.find(r => r.scope_type === 'brand' && variant.product.brand && r.scope_id === variant.product.brand)
      || rules.find(r => r.scope_type === 'category' && variant.product.category_id && r.scope_id === variant.product.category_id)
      || rules.find(r => r.scope_type === 'global');
    if (!rule) rule = { overhead_percent: 20 as any, profit_percent: 35 as any, tax_percent: 14 as any } as any;
    const oh = Number(rule.overhead_percent)/100;
    const pf = Number(rule.profit_percent)/100;
    const tx = Number(rule.tax_percent)/100;
    const price1 = cost * (1 + oh);
    const price2 = price1 * (1 + pf);
    const price3 = price2 * (1 + tx);
    const selling = Math.round(price3 * 100) / 100;
    const netPrice = Math.round(price2 * 100) / 100;
    const taxAmount = Math.round((selling - netPrice) * 100) / 100;
    const min_allowed = Math.round(cost * (1 + oh) * (1 + tx) * 100) / 100; // cost + protected overhead + tax
    return {
      cost,
      overhead_percent: Number(rule.overhead_percent),
      profit_percent: Number(rule.profit_percent),
      tax_percent: Number(rule.tax_percent),
      net_price: netPrice,
      tax_amount: taxAmount,
      selling_price: selling,
      min_allowed_price: min_allowed,
      breakdown: { price_after_overhead: price1, price_after_profit: price2, price_after_tax: price3 }
    };
  }
}
