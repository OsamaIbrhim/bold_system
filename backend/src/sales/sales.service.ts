import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { randomUUID } from 'crypto';
import { CreateReturnDto } from './dto/create-return.dto';
import { assertBranchAccess } from '../auth/branch-access';
import { ListSalesDto } from './dto/list-sales.dto';
@Injectable()
export class SalesService {
  private readonly countCache = new Map<string, { expiresAt: number; value: Promise<number> }>();

  constructor(private prisma: PrismaService, private pricing: PricingService) {}

  async listSales(dto: ListSalesDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.SalesInvoiceWhereInput = {
      ...(branchId ? { branch_id: branchId } : {}),
      ...(dto.payment_method ? { payment_method: dto.payment_method } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.from || dto.to ? {
        created_at: {
          ...(dto.from ? { gte: new Date(dto.from) } : {}),
          ...(dto.to ? { lte: this.endOfDay(dto.to) } : {}),
        },
      } : {}),
      ...(q ? {
        OR: [
          { invoice_number: { contains: q, mode: 'insensitive' } },
          { customer: { phone: { contains: q } } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
    };
    const countKey = JSON.stringify({ branchId, q, payment: dto.payment_method, status: dto.status, from: dto.from, to: dto.to });
    const [total, items] = await Promise.all([
      this.cachedSalesCount(countKey, where),
      this.prisma.salesInvoice.findMany({
        where,
        select: {
          id: true,
          invoice_number: true,
          branch_id: true,
          branch: { select: { code: true, name_ar: true, name_en: true } },
          customer: { select: { id: true, name: true, phone: true } },
          cashier_id: true,
          terminal: { select: { id: true, terminal_code: true, name: true } },
          status: true,
          subtotal: true,
          discount_amount: true,
          tax_amount: true,
          total: true,
          payment_method: true,
          language: true,
          sync_id: true,
          created_at: true,
          _count: { select: { items: true, original_returns: true } },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ]);
    return {
      items,
      page: dto.page,
      page_size: dto.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / dto.page_size)),
      server_time: new Date().toISOString(),
    };
  }

  private cachedSalesCount(key: string, where: Prisma.SalesInvoiceWhereInput) {
    const now = Date.now();
    const cached = this.countCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const ttl = Math.min(30_000, Math.max(0, Number(process.env.LIST_COUNT_CACHE_MS || 5_000)));
    let value: Promise<number>;
    value = this.prisma.salesInvoice.count({ where }).then((total) => {
      if (this.countCache.get(key)?.value === value) {
        this.countCache.set(key, { expiresAt: Date.now() + ttl, value: Promise.resolve(total) });
      }
      return total;
    }).catch((error) => {
      if (this.countCache.get(key)?.value === value) this.countCache.delete(key);
      throw error;
    });
    this.countCache.set(key, { expiresAt: Number.POSITIVE_INFINITY, value });
    if (this.countCache.size > 500) this.countCache.delete(this.countCache.keys().next().value!);
    return value;
  }

  async getInvoice(id: string, actor: AuthenticatedUser) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            variant: { include: { product: true } },
            return_items: { where: { return_record: { status: 'completed' } } },
          },
        },
        branch: true,
        customer: true,
        terminal: { select: { id: true, terminal_code: true, name: true } },
        original_returns: { include: { items: true }, orderBy: { created_at: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertBranchAccess(actor, invoice.branch_id, ['owner']);
    return invoice;
  }

  private endOfDay(value: string) {
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
    return date;
  }

  // Create sale – idempotent via sync_id for offline POS
  async createSale(dto: CreateSaleDto, actor: AuthenticatedUser, terminalId?: string) {
    if (actor.role !== 'owner' && actor.branch_id !== dto.branch_id) {
      throw new ForbiddenException('You cannot create a sale for another branch');
    }

    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(item.variant_id, (quantities.get(item.variant_id) || 0) + item.qty);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: dto.branch_id, is_active: true } });
      if (!branch) throw new NotFoundException('Active branch not found');

      if (dto.sync_id) {
        const existing = await tx.salesInvoice.findUnique({
          where: { sync_id: dto.sync_id },
          include: { items: true },
        });
        if (existing) {
          if (existing.branch_id !== dto.branch_id) {
            throw new ConflictException('sync_id already belongs to another branch');
          }
          return existing;
        }
      }

      const saleItems: {
        variant_id: string;
        qty: number;
        unit_price: number;
        unit_cost: number;
        tax: number;
      }[] = [];

      const variantIds = [...quantities.keys()];
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, product: { is_active: true } },
        include: { product: true },
      });
      if (variants.length !== variantIds.length) {
        const found = new Set(variants.map((variant) => variant.id));
        const missing = variantIds.find((id) => !found.has(id));
        throw new NotFoundException(`Active variant not found: ${missing}`);
      }
      const quotes = await this.pricing.calculateMany(variants, tx);
      for (const variant of variants) {
        const quote = quotes.get(variant.id)!;
        saleItems.push({
          variant_id: variant.id,
          qty: quantities.get(variant.id)!,
          unit_price: quote.net_price,
          unit_cost: Number(variant.cost_price),
          tax: quote.tax_amount,
        });
      }

      const subtotalDecimal = saleItems.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.unit_price).mul(item.qty)),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2);
      const taxDecimal = saleItems.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.tax).mul(item.qty)),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2);
      const subtotal = subtotalDecimal.toNumber();
      const taxAmount = taxDecimal.toNumber();
      const total = subtotalDecimal.plus(taxDecimal).toDecimalPlaces(2).toNumber();

      for (const item of saleItems) {
        const changed = await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "qty_on_hand" = "qty_on_hand" - ${item.qty},
              "last_sold_at" = CURRENT_TIMESTAMP
          WHERE "branch_id" = ${dto.branch_id}::uuid
            AND "variant_id" = ${item.variant_id}::uuid
            AND ("qty_on_hand" - "qty_reserved") >= ${item.qty}
        `;
        if (changed !== 1) {
          throw new ConflictException(`Insufficient stock for variant ${item.variant_id}`);
        }
      }

      let customerId: string | undefined;
      if (dto.customer_phone) {
        const customer = await tx.customer.upsert({
          where: { phone: dto.customer_phone },
          update: {},
          create: { phone: dto.customer_phone, whatsapp: dto.customer_phone },
        });
        customerId = customer.id;
      }

      const invoiceNumber = `B-${branch.code}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const invoice = await tx.salesInvoice.create({
        data: {
          invoice_number: invoiceNumber,
          branch_id: dto.branch_id,
          customer_id: customerId,
          cashier_id: actor.sub,
          terminal_id: terminalId,
          subtotal,
          tax_amount: taxAmount,
          total,
          payment_method: dto.payment_method,
          language: dto.language || 'ar',
          sync_id: dto.sync_id,
          items: {
            create: saleItems.map((item) => ({
              variant_id: item.variant_id,
              qty: item.qty,
              unit_price: item.unit_price,
              unit_cost: item.unit_cost,
              unit_tax: item.tax,
            })),
          },
        },
        include: { items: true },
      });

      if (customerId) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            total_invoices: { increment: 1 },
            total_spent: { increment: total },
          },
        });
      }

      return invoice;
    });
    this.countCache.clear();
    return result;
  }
  async createReturn(dto: CreateReturnDto, actor: AuthenticatedUser) {
    const requested = new Map<string, number>();
    for (const item of dto.items) {
      requested.set(item.sales_invoice_item_id, (requested.get(item.sales_invoice_item_id) || 0) + item.qty);
    }

    return this.prisma.$transaction(async (tx) => {
      const original = await tx.salesInvoice.findUnique({
        where: { id: dto.original_invoice_id },
        include: { items: true },
      });
      if (!original) throw new NotFoundException('Original invoice not found');
      if (actor.role !== 'owner' && actor.branch_id !== original.branch_id) {
        throw new ForbiddenException('You cannot return a sale from another branch');
      }

      const ageDays = (Date.now() - original.created_at.getTime()) / 86400000;
      if (ageDays > 14) throw new BadRequestException('Return window expired (14 days)');

      const returnItems: {
        sales_invoice_item_id: string;
        variant_id: string;
        qty: number;
        unit_price: number;
        unit_cost: number;
        unit_tax: number;
      }[] = [];

      for (const [saleItemId, qty] of requested) {
        const soldItem = original.items.find((item) => item.id === saleItemId);
        if (!soldItem) {
          throw new BadRequestException(`Item ${saleItemId} does not belong to the original invoice`);
        }
        // Serialize returns against the same sold line. Without this lock two
        // concurrent requests could both observe the same remaining quantity.
        await tx.$queryRaw`SELECT "id" FROM "SalesInvoiceItem" WHERE "id" = ${saleItemId}::uuid FOR UPDATE`;
        const alreadyReturned = await tx.returnItem.aggregate({
          where: {
            sales_invoice_item_id: saleItemId,
            return_record: { status: 'completed' },
          },
          _sum: { qty: true },
        });
        const remaining = soldItem.qty - (alreadyReturned._sum.qty || 0);
        if (qty > remaining) {
          throw new ConflictException(`Only ${remaining} unit(s) remain returnable for item ${saleItemId}`);
        }

        let unitTax = Number(soldItem.unit_tax);
        if (unitTax === 0 && Number(original.subtotal) > 0) {
          unitTax = Math.round(Number(soldItem.unit_price) * (Number(original.tax_amount) / Number(original.subtotal)) * 100) / 100;
        }
        returnItems.push({
          sales_invoice_item_id: saleItemId,
          variant_id: soldItem.variant_id,
          qty,
          unit_price: Number(soldItem.unit_price),
          unit_cost: Number(soldItem.unit_cost),
          unit_tax: unitTax,
        });
      }

      const refundSubtotalDecimal = returnItems.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.unit_price).mul(item.qty)),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2);
      const refundTaxDecimal = returnItems.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.unit_tax).mul(item.qty)),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2);
      const refundSubtotal = refundSubtotalDecimal.toNumber();
      const refundTax = refundTaxDecimal.toNumber();
      const refundTotal = refundSubtotalDecimal.plus(refundTaxDecimal).toDecimalPlaces(2).toNumber();
      const totalReturnedQty = returnItems.reduce((sum, item) => sum + item.qty, 0);
      const originalQty = original.items.reduce((sum, item) => sum + item.qty, 0);

      const returnRecord = await tx.return.create({
        data: {
          original_invoice_id: original.id,
          branch_id: original.branch_id,
          return_invoice_number: `R-${Date.now()}-${randomUUID().slice(0, 8)}`,
          reason: dto.reason,
          is_partial: totalReturnedQty < originalQty,
          created_by: actor.sub,
          refund_subtotal: refundSubtotal,
          refund_tax: refundTax,
          refund_total: refundTotal,
          status: 'completed',
          items: { create: returnItems },
        },
        include: { items: true },
      });

      for (const item of returnItems) {
        await tx.inventoryStock.upsert({
          where: { branch_id_variant_id: { branch_id: original.branch_id, variant_id: item.variant_id } },
          update: { qty_on_hand: { increment: item.qty } },
          create: { branch_id: original.branch_id, variant_id: item.variant_id, qty_on_hand: item.qty },
        });
        await tx.productVariant.update({
          where: { id: item.variant_id },
          data: { return_count: { increment: item.qty } },
        });
      }

      await tx.productVariant.updateMany({
        where: { id: { in: returnItems.map((item) => item.variant_id) }, return_count: { gte: 3 } },
        data: { qa_flag: true },
      });

      if (original.customer_id) {
        const customer = await tx.customer.findUnique({ where: { id: original.customer_id } });
        if (customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              total_spent: Prisma.Decimal.max(
                new Prisma.Decimal(0),
                new Prisma.Decimal(customer.total_spent).minus(refundTotal),
              ),
            },
          });
        }
      }

      return returnRecord;
    });
  }

  async findReturnableInvoice(reference: string, actor: AuthenticatedUser) {
    const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: byId ? { id: reference } : { invoice_number: reference },
      select: {
        id: true,
        invoice_number: true,
        branch_id: true,
        total: true,
        created_at: true,
        items: {
          select: {
            id: true,
            variant_id: true,
            qty: true,
            unit_price: true,
            unit_tax: true,
            variant: { select: { sku: true, product: { select: { name_en: true, name_ar: true } } } },
            return_items: {
              where: { return_record: { status: 'completed' } },
              select: { qty: true },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertBranchAccess(actor, invoice.branch_id);
    return {
      ...invoice,
      items: invoice.items.map((item) => {
        const returnedQty = item.return_items.reduce((sum, record) => sum + record.qty, 0);
        const { return_items: _returnItems, ...safe } = item;
        return { ...safe, returned_qty: returnedQty, returnable_qty: item.qty - returnedQty };
      }),
    };
  }
}
