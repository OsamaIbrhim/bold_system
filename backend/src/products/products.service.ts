import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateVariantDto } from './dto/product.dto';
@Injectable()
export class ProductsService {
  private readonly countCache = new Map<string, { expiresAt: number; value: Promise<number> }>();

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
    // List/count consistency to the exact millisecond is not a business
    // invariant. Avoid a read transaction that pins one pool connection while
    // two independent queries run, and coalesce repeated identical counts.
    const [total, variants] = await Promise.all([
      this.cachedCount(query, where),
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
    let suggestions: { value: string; label: string }[] = [];
    if (query.length >= 2 && total === 0) {
      const similar = await this.prisma.$queryRaw<Array<{ name_en: string; name_ar: string | null; sku: string; score: number }>>`
        SELECT p."name_en", p."name_ar", v."sku",
          GREATEST(
            similarity(COALESCE(p."name_en", ''), ${query}),
            similarity(COALESCE(p."name_ar", ''), ${query}),
            similarity(v."sku", ${query})
          ) AS score
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."product_id"
        WHERE p."is_active" = true
        ORDER BY score DESC
        LIMIT 8
      `;
      const seen = new Set<string>();
      suggestions = similar
        .filter((item) => item.score >= 0.15)
        .map((item) => ({ value: item.name_en || item.sku, label: item.name_ar || item.name_en || item.sku }))
        .filter((item) => !seen.has(item.value) && !!seen.add(item.value))
        .slice(0, 3);
    }
    return {
      items,
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      suggestions,
    };
  }

  private cachedCount(query: string, where: any) {
    const key = query.toLocaleLowerCase('en-US');
    const now = Date.now();
    const cached = this.countCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const ttl = Math.min(30_000, Math.max(0, Number(process.env.LIST_COUNT_CACHE_MS || 5_000)));
    let value: Promise<number>;
    value = this.prisma.productVariant.count({ where }).then((total) => {
      if (this.countCache.get(key)?.value === value) {
        this.countCache.set(key, { expiresAt: Date.now() + ttl, value: Promise.resolve(total) });
      }
      return total;
    }).catch((error) => {
      if (this.countCache.get(key)?.value === value) this.countCache.delete(key);
      throw error;
    });
    // An in-flight count never expires; all concurrent callers share it. The
    // short TTL starts only after the database query has completed.
    this.countCache.set(key, { expiresAt: Number.POSITIVE_INFINITY, value });
    if (this.countCache.size > 200) this.countCache.delete(this.countCache.keys().next().value!);
    return value;
  }

  private invalidateCounts() {
    this.countCache.clear();
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
    this.invalidateCounts();
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
    const removed = await this.prisma.productVariant.delete({ where: { id }});
    this.invalidateCounts();
    return removed;
  }
}
