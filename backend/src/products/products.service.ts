import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
            barcode_internal: dto.barcode_internal || dto.sku,
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
  async updateVariant(id: string, dto: any) {
    const exists = await this.prisma.productVariant.findUnique({ where: { id }});
    if (!exists) throw new NotFoundException('Variant not found');
    return this.prisma.productVariant.update({
      where: { id },
      data: {
        sku: dto.sku ?? undefined,
        barcode_ean13: dto.barcode_ean13,
        barcode_internal: dto.barcode_internal,
        size: dto.size,
        color: dto.color,
        style: dto.style,
        cost_price: dto.cost_price !== undefined ? dto.cost_price : undefined,
      }
    });
  }
  async removeVariant(id: string) {
    // prevent delete if stock exists or sales exist
    const stock = await this.prisma.inventoryStock.findMany({ where: { variant_id: id }});
    const totalStock = stock.reduce((s, i) => s + i.qty_on_hand, 0);
    if (totalStock > 0) throw new BadRequestException('Cannot delete – stock exists: ' + totalStock + ' pcs. Adjust inventory to 0 first.');
    const salesCount = await this.prisma.salesInvoiceItem.count({ where: { variant_id: id }});
    if (salesCount > 0) throw new BadRequestException('Cannot delete – variant has sales history. Deactivate product instead.');
    return this.prisma.productVariant.delete({ where: { id }});
  }
}
