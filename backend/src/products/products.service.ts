import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateVariantDto } from './dto/product.dto';
@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}
  async list(q: string, page: number, pageSize: number, branchId?: string, includeCost = false) {
    const query = q.trim();
    const where = query ? {
      product: { is_active: true },
      OR: [
        { sku: { contains: query, mode: 'insensitive' as const } },
        { barcode_ean13: query },
        { barcode_internal: query },
        { product: { name_en: { contains: query, mode: 'insensitive' as const } } },
        { product: { name_ar: { contains: query, mode: 'insensitive' as const } } },
      ],
    } : { product: { is_active: true } };
    const [total, variants] = await this.prisma.$transaction([
      this.prisma.productVariant.count({ where }),
      this.prisma.productVariant.findMany({
        where,
        include: {
          product: true,
          inventory: branchId ? { where: { branch_id: branchId } } : true,
        },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const items = variants.map((variant) => this.present(variant, branchId, includeCost));
    return {
      items,
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async search(q: string, branchId?: string, includeCost = false) {
    const variants = await this.prisma.productVariant.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { barcode_ean13: q },
          { barcode_internal: q },
          { product: { name_en: { contains: q, mode: 'insensitive' } } }
        ]
      },
      include: {
        product: true,
        inventory: branchId ? { where: { branch_id: branchId } } : true,
      },
      take: 20,
    });
    return variants.map((variant) => this.present(variant, branchId, includeCost));
  }

  private present(variant: any, branchId?: string, includeCost = false) {
    const result = {
      ...variant,
      stock_by_branch: variant.inventory,
      available_here: branchId
        ? variant.inventory.find((item: any) => item.branch_id === branchId)?.qty_on_hand || 0
        : undefined,
    };
    if (includeCost) return result;
    const { cost_price: _costPrice, ...safe } = result;
    return safe;
  }
  async createProduct(dto: CreateProductDto) {
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
  async updateVariant(id: string, dto: UpdateVariantDto) {
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
