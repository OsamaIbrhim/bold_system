import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService, private pricing: PricingService) {}
  async pull(branch_id: string) {
    // This is intentionally a full snapshot. The current tables do not all
    // carry reliable updated_at values, so pretending to offer a cursor would
    // miss price and stock changes. Incremental sync belongs on a change log.
    const variants = await this.prisma.productVariant.findMany({
      include: { product: true },
    });
    const products = await Promise.all(variants.map(async (variant) => {
      const quote = await this.pricing.calculate(variant.id);
      return {
        id: variant.id,
        sku: variant.sku,
        name_en: variant.product.name_en,
        barcode_ean13: variant.barcode_ean13,
        barcode_internal: variant.barcode_internal,
        size: variant.size,
        color: variant.color,
        selling_price: quote.net_price,
        unit_tax: quote.tax_amount,
      };
    }));
    const stock = await this.prisma.inventoryStock.findMany({ where: { branch_id }});
    return { mode: 'snapshot', server_time: new Date().toISOString(), products, stock };
  }
}
