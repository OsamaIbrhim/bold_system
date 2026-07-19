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
});
