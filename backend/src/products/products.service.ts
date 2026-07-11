import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}
  async search(q: string, branchId?: string) {
    const variants = await this.prisma.productVariant.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { barcode_ean13: q },
          { barcode_internal: q },
          { product: { name_en: { contains: q, mode: 'insensitive' } } }
        ]
      },
      include: { product: true, inventory: true }
    });
    return variants.map(v => ({
      ...v,
      stock_by_branch: v.inventory,
      available_here: branchId ? v.inventory.find(i=>i.branch_id===branchId)?.qty_on_hand || 0 : undefined
    }));
  }
  async createProduct(dto: any) {
    // Create product + first variant in one call
    // dto: { name_en, sku, barcode_ean13?, barcode_internal?, size?, color?, style?, cost_price, brand?, category_id? }
    const product = await this.prisma.product.create({
      data: {
        name_en: dto.name_en,
        name_ar: dto.name_ar,
        brand: dto.brand,
        category_id: dto.category_id,
        has_variants: !!(dto.size || dto.color || dto.style),
        variants: {
          create: [{
            sku: dto.sku,
            barcode_ean13: dto.barcode_ean13 || null,
            barcode_internal: dto.barcode_internal || null,
            size: dto.size || null,
            color: dto.color || null,
            style: dto.style || null,
            cost_price: dto.cost_price || 0,
          }]
        }
      },
      include: { variants: true }
    });
    return product;
  }
}
