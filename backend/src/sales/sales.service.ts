import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { PriceSnapshotService } from '../pricing/price-snapshot.service';
import { CreateSaleDto, CreateSaleItemDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { randomUUID } from 'crypto';
import { assertBranchAccess } from '../auth/branch-access';
import { ListSalesDto } from './dto/list-sales.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ListReturnsDto } from './dto/list-returns.dto';

@Injectable()
export class SalesService {
  private readonly countCache = new Map<string, { expiresAt: number; value: Promise<number> }>();

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private priceSnapshots: PriceSnapshotService,
  ) {}

  async listSales(dto: ListSalesDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.SalesInvoiceWhereInput = {
      ...(branchId ? { branch_id: branchId } : {}),
      ...(dto.payment_method ? { payment_method: dto.payment_method } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.from || dto.to ? { created_at: { ...(dto.from ? { gte: new Date(dto.from) } : {}), ...(dto.to ? { lte: this.endOfDay(dto.to) } : {}) } } : {}),
      ...(q ? { OR: [
        { invoice_number: { contains: q, mode: 'insensitive' } },
        { customer: { phone: { contains: q } } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
      ] } : {}),
    };
    const countKey = JSON.stringify({ branchId, q, payment: dto.payment_method, status: dto.status, from: dto.from, to: dto.to });
    const [total, items] = await Promise.all([
      this.cachedSalesCount(countKey, where),
      this.prisma.salesInvoice.findMany({
        where,
        select: {
          id: true, invoice_number: true, branch_id: true,
          branch: { select: { code: true, name_ar: true, name_en: true } },
          customer: { select: { id: true, name: true, phone: true } },
          cashier_id: true,
          terminal: { select: { id: true, terminal_code: true, name: true } },
          status: true, subtotal: true, discount_amount: true, tax_amount: true, total: true,
          payment_method: true, language: true, sync_id: true, created_at: true,
          _count: { select: { items: true, original_returns: true } },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ]);
    return { items, page: dto.page, page_size: dto.page_size, total, total_pages: Math.max(1, Math.ceil(total / dto.page_size)), server_time: new Date().toISOString() };
  }

  private cachedSalesCount(key: string, where: Prisma.SalesInvoiceWhereInput) {
    const now = Date.now();
    const cached = this.countCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const ttl = Math.min(30_000, Math.max(0, Number(process.env.LIST_COUNT_CACHE_MS || 5_000)));
    let value: Promise<number>;
    value = this.prisma.salesInvoice.count({ where }).then((total) => {
      if (this.countCache.get(key)?.value === value) this.countCache.set(key, { expiresAt: Date.now() + ttl, value: Promise.resolve(total) });
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
        items: { include: { variant: { include: { product: true } }, return_items: { where: { return_record: { status: 'completed' } } } } },
        branch: true, customer: true,
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

  private normalizeLines(items: CreateSaleItemDto[]) {
    const signed = items.every((item) =>
      item.unit_price !== undefined && item.unit_tax !== undefined && !!item.price_version && !!item.price_token,
    );
    const legacy = items.every((item) =>
      item.unit_price === undefined && item.unit_tax === undefined && !item.price_version && !item.price_token,
    );
    if (!signed && !legacy) {
      throw new UnprocessableEntityException({
        code: 'MIXED_PRICE_SNAPSHOT_MODE',
        message_ar: 'لا يمكن خلط أصناف بأسعار موقعة مع أصناف قديمة في نفس الفاتورة.',
      });
    }
    const lines = new Map<string, CreateSaleItemDto>();
    for (const item of items) {
      const existing = lines.get(item.variant_id);
      if (!existing) lines.set(item.variant_id, { ...item });
      else {
        if (signed && (
          existing.unit_price !== item.unit_price || existing.unit_tax !== item.unit_tax ||
          existing.price_version !== item.price_version || existing.price_token !== item.price_token
        )) {
          throw new UnprocessableEntityException({ code: 'CONFLICTING_PRICE_SNAPSHOTS', message_ar: 'الصنف نفسه يحمل أكثر من إصدار سعر داخل الفاتورة.' });
        }
        existing.qty += item.qty;
      }
    }
    return { mode: signed ? 'signed' as const : 'legacy' as const, lines: [...lines.values()] };
  }

  async createSale(dto: CreateSaleDto, actor: AuthenticatedUser, terminalId?: string) {
    if (actor.role !== 'owner' && actor.branch_id !== dto.branch_id) {
      throw new ForbiddenException('You cannot create a sale for another branch');
    }
    const normalized = this.normalizeLines(dto.items);
    if (normalized.mode === 'legacy' && dto.local_total === undefined) {
      throw new UnprocessableEntityException({
        code: 'LEGACY_LOCAL_TOTAL_REQUIRED',
        message_ar: 'العملية القديمة لا تحتوي إجماليًا محليًا موثوقًا وتحتاج مراجعة يدوية.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: dto.branch_id, is_active: true } });
      if (!branch) throw new NotFoundException('Active branch not found');

      if (dto.sync_id) {
        const existing = await tx.salesInvoice.findUnique({ where: { sync_id: dto.sync_id }, include: { items: true } });
        if (existing) {
          if (existing.branch_id !== dto.branch_id) throw new ConflictException('sync_id already belongs to another branch');
          return existing;
        }
      }

      const variantIds = normalized.lines.map((item) => item.variant_id);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, product: { is_active: true } },
        include: { product: true },
      });
      if (variants.length !== variantIds.length) {
        const found = new Set(variants.map((variant) => variant.id));
        const missing = variantIds.find((id) => !found.has(id));
        throw new NotFoundException(`Active variant not found: ${missing}`);
      }
      const variantsById = new Map<string, any>(variants.map((variant: any) => [variant.id, variant]));
      const currentQuotes = normalized.mode === 'legacy' ? await this.pricing.calculateMany(variants, tx) : null;
      const acceptedSnapshots: Array<{ variant_id: string; price_version: string; issued_at: string }> = [];

      const saleItems = normalized.lines.map((line) => {
        const variant = variantsById.get(line.variant_id)!;
        let unitPrice: number;
        let unitTax: number;
        if (normalized.mode === 'signed') {
          const claims = this.priceSnapshots.verify({
            branch_id: dto.branch_id,
            variant_id: line.variant_id,
            unit_price: line.unit_price!,
            unit_tax: line.unit_tax!,
            price_version: line.price_version!,
            price_token: line.price_token!,
          });
          unitPrice = line.unit_price!;
          unitTax = line.unit_tax!;
          acceptedSnapshots.push({ variant_id: line.variant_id, price_version: claims.price_version, issued_at: claims.issued_at });
        } else {
          const quote = currentQuotes!.get(line.variant_id)!;
          unitPrice = quote.net_price;
          unitTax = quote.tax_amount;
        }
        return {
          variant_id: line.variant_id,
          qty: line.qty,
          unit_price: unitPrice,
          unit_cost: Number(variant.cost_price),
          tax: unitTax,
        };
      });

      const subtotalDecimal = saleItems.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.unit_price).mul(item.qty)), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const taxDecimal = saleItems.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.tax).mul(item.qty)), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const subtotal = subtotalDecimal.toNumber();
      const taxAmount = taxDecimal.toNumber();
      const total = subtotalDecimal.plus(taxDecimal).toDecimalPlaces(2).toNumber();

      if (dto.local_total !== undefined && Math.round(dto.local_total * 100) !== Math.round(total * 100)) {
        throw new UnprocessableEntityException({
          code: normalized.mode === 'legacy' ? 'LEGACY_PRICE_RECONCILIATION_REQUIRED' : 'LOCAL_TOTAL_MISMATCH',
          message_ar: normalized.mode === 'legacy'
            ? 'فاتورة قديمة معلقة تختلف عن السعر الحالي وتحتاج مراجعة يدوية دون تغيير المبلغ المدفوع.'
            : 'إجمالي الفاتورة المحلية لا يطابق لقطات الأسعار الموقعة.',
          local_total: dto.local_total,
          server_total: total,
        });
      }

      for (const item of saleItems) {
        const changed = await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "qty_on_hand" = "qty_on_hand" - ${item.qty}, "last_sold_at" = CURRENT_TIMESTAMP
          WHERE "branch_id" = ${dto.branch_id}::uuid
            AND "variant_id" = ${item.variant_id}::uuid
            AND ("qty_on_hand" - "qty_reserved") >= ${item.qty}
        `;
        if (changed !== 1) throw new ConflictException(`Insufficient stock for variant ${item.variant_id}`);
      }

      let customerId: string | undefined;
      if (dto.customer_phone) {
        const customer = await tx.customer.upsert({
          where: { phone: dto.customer_phone }, update: {},
          create: { phone: dto.customer_phone, whatsapp: dto.customer_phone },
        });
        customerId = customer.id;
      }

      const invoiceNumber = `B-${branch.code}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const invoice = await tx.salesInvoice.create({
        data: {
          invoice_number: invoiceNumber, branch_id: dto.branch_id, customer_id: customerId,
          cashier_id: actor.sub, terminal_id: terminalId,
          subtotal, tax_amount: taxAmount, total,
          payment_method: dto.payment_method, language: dto.language || 'ar', sync_id: dto.sync_id,
          items: { create: saleItems.map((item) => ({
            variant_id: item.variant_id, qty: item.qty,
            unit_price: item.unit_price, unit_cost: item.unit_cost, unit_tax: item.tax,
          })) },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          user_id: actor.sub,
          action: normalized.mode === 'signed' ? 'sale.price_snapshot.accepted' : 'sale.legacy_price.accepted',
          entity: 'SalesInvoice', entity_id: invoice.id,
          meta: {
            sync_id: dto.sync_id || null,
            local_total: dto.local_total ?? null,
            invoice_total: total,
            pricing_mode: normalized.mode,
            snapshots: acceptedSnapshots,
          },
        },
      });

      if (customerId) {
        await tx.customer.update({ where: { id: customerId }, data: { total_invoices: { increment: 1 }, total_spent: { increment: total } } });
      }
      return invoice;
    });
    this.countCache.clear();
    return result;
  }
  async createReturn(dto: CreateReturnDto, actor: AuthenticatedUser) {
    const requested = new Map<string, number>();
    for (const item of dto.items) {
      requested.set(
        item.sales_invoice_item_id,
        (requested.get(item.sales_invoice_item_id) || 0) + item.qty,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const original = await tx.salesInvoice.findUnique({
        where: { id: dto.original_invoice_id },
        include: { items: true },
      });
      if (!original) throw new NotFoundException('Original invoice not found');
      if (actor.role !== 'owner' && actor.branch_id !== original.branch_id) {
        throw new ForbiddenException('You cannot return a sale from another branch');
      }

      const ageDays = (Date.now() - original.created_at.getTime()) / 86_400_000;
      if (ageDays > 14) {
        throw new BadRequestException('Return window expired (14 days)');
      }

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
          throw new BadRequestException(
            `Item ${saleItemId} does not belong to the original invoice`,
          );
        }

        await tx.$queryRaw`
          SELECT "id"
          FROM "SalesInvoiceItem"
          WHERE "id" = ${saleItemId}::uuid
          FOR UPDATE
        `;

        const alreadyReturned = await tx.returnItem.aggregate({
          where: {
            sales_invoice_item_id: saleItemId,
            return_record: { status: 'completed' },
          },
          _sum: { qty: true },
        });
        const remaining = soldItem.qty - (alreadyReturned._sum.qty || 0);
        if (qty > remaining) {
          throw new ConflictException(
            `Only ${remaining} unit(s) remain returnable for item ${saleItemId}`,
          );
        }

        let unitTax = Number(soldItem.unit_tax);
        if (unitTax === 0 && Number(original.subtotal) > 0) {
          unitTax =
            Math.round(
              Number(soldItem.unit_price) *
                (Number(original.tax_amount) / Number(original.subtotal)) *
                100,
            ) / 100;
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

      const refundSubtotalDecimal = returnItems
        .reduce(
          (sum, item) =>
            sum.plus(new Prisma.Decimal(item.unit_price).mul(item.qty)),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(2);
      const refundTaxDecimal = returnItems
        .reduce(
          (sum, item) =>
            sum.plus(new Prisma.Decimal(item.unit_tax).mul(item.qty)),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(2);
      const refundSubtotal = refundSubtotalDecimal.toNumber();
      const refundTax = refundTaxDecimal.toNumber();
      const refundTotal = refundSubtotalDecimal
        .plus(refundTaxDecimal)
        .toDecimalPlaces(2)
        .toNumber();
      const totalReturnedQty = returnItems.reduce(
        (sum, item) => sum + item.qty,
        0,
      );
      const originalQty = original.items.reduce(
        (sum, item) => sum + item.qty,
        0,
      );

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
          where: {
            branch_id_variant_id: {
              branch_id: original.branch_id,
              variant_id: item.variant_id,
            },
          },
          update: { qty_on_hand: { increment: item.qty } },
          create: {
            branch_id: original.branch_id,
            variant_id: item.variant_id,
            qty_on_hand: item.qty,
          },
        });
        await tx.productVariant.update({
          where: { id: item.variant_id },
          data: { return_count: { increment: item.qty } },
        });
      }

      await tx.productVariant.updateMany({
        where: {
          id: { in: returnItems.map((item) => item.variant_id) },
          return_count: { gte: 3 },
        },
        data: { qa_flag: true },
      });

      if (original.customer_id) {
        const customer = await tx.customer.findUnique({
          where: { id: original.customer_id },
        });
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
    }, {
      maxWait: 5_000,
      timeout: 20_000,
    });

    this.countCache.clear();
    return result;
  }

  async findReturnableInvoice(reference: string, actor: AuthenticatedUser) {
    const byId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        reference,
      );
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
            variant: {
              select: {
                sku: true,
                product: { select: { name_en: true, name_ar: true } },
              },
            },
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
        const returnedQty = item.return_items.reduce(
          (sum, record) => sum + record.qty,
          0,
        );
        const { return_items: _returnItems, ...safe } = item;
        return {
          ...safe,
          returned_qty: returnedQty,
          returnable_qty: item.qty - returnedQty,
        };
      }),
    };
  }

  async listReturns(dto: ListReturnsDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.ReturnWhereInput = {
      ...(branchId ? { branch_id: branchId } : {}),
      ...(q
        ? {
            OR: [
              {
                return_invoice_number: {
                  contains: q,
                  mode: 'insensitive',
                },
              },
              {
                original_invoice: {
                  invoice_number: {
                    contains: q,
                    mode: 'insensitive',
                  },
                },
              },
              {
                original_invoice: {
                  customer: { phone: { contains: q } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.return.count({ where }),
      this.prisma.return.findMany({
        where,
        select: {
          id: true,
          return_invoice_number: true,
          original_invoice_id: true,
          branch_id: true,
          reason: true,
          is_partial: true,
          created_by: true,
          refund_subtotal: true,
          refund_tax: true,
          refund_total: true,
          status: true,
          created_at: true,
          _count: { select: { items: true } },
          original_invoice: {
            select: {
              id: true,
              invoice_number: true,
              total: true,
              payment_method: true,
              customer: {
                select: { id: true, name: true, phone: true },
              },
              terminal: {
                select: { id: true, terminal_code: true, name: true },
              },
            },
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ]);

    return {
      items,
      total,
      page: dto.page,
      page_size: dto.page_size,
      total_pages: Math.max(1, Math.ceil(total / dto.page_size)),
      server_time: new Date().toISOString(),
    };
  }

}
