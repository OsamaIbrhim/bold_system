import { PricingService } from './pricing.service';

describe('PricingService', () => {
  it('uses category rules and keeps net plus tax equal to the quoted total', async () => {
    const prisma = {
      productVariant: { findUnique: jest.fn().mockResolvedValue({
        id: 'variant-1', product_id: 'product-1', cost_price: 85,
        product: { category_id: 'category-1', brand: 'Bold' },
      }) },
      pricingRule: { findMany: jest.fn().mockResolvedValue([{
        scope_type: 'category', scope_id: 'category-1', overhead_percent: 17,
        profit_percent: 33, tax_percent: 14,
      }]) },
    };
    const quote = await new PricingService(prisma as any).calculate('variant-1');
    expect(quote.overhead_percent).toBe(17);
    expect(quote.selling_price).toBe(Math.round((quote.net_price + quote.tax_amount) * 100) / 100);
    expect(quote.selling_price.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
  });

  it('calculates a catalog with one pricing-rule query', async () => {
    const prisma = {
      pricingRule: { findMany: jest.fn().mockResolvedValue([{
        scope_type: 'global', scope_id: null, overhead_percent: 20,
        profit_percent: 35, tax_percent: 14,
      }]) },
    };
    const variants = Array.from({ length: 500 }, (_, index) => ({
      id: `variant-${index}`,
      product_id: `product-${index}`,
      cost_price: 100,
      product: { category_id: null, brand: null },
    }));

    const quotes = await new PricingService(prisma as any).calculateMany(variants);

    expect(prisma.pricingRule.findMany).toHaveBeenCalledTimes(1);
    expect(quotes.size).toBe(500);
    expect(quotes.get('variant-499')).toMatchObject({ net_price: 162, tax_amount: 22.68, selling_price: 184.68 });
  });
});
