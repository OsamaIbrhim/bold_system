import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosTerminal, Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { PriceSnapshotService } from '../pricing/price-snapshot.service';
import { CreateSaleDto, CreateSaleItemDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { createHash, randomUUID } from 'crypto';
import { assertBranchAccess } from '../auth/branch-access';
import { ListSalesDto } from './dto/list-sales.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ListReturnsDto } from './dto/list-returns.dto';
import { OfflineAccountingTicketService } from '../shifts/offline-accounting-ticket.service';
import {
  decimal,
  lineMoney,
  money,
  moneyNumber,
  moneyString,
  sameMoney,
  sumMoney,
} from '../common/money';

@Injectable()
export class SalesService {
  private readonly countCache = new Map<string, { expiresAt: number; value: Promise<number> }>();

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private priceSnapshots: PriceSnapshotService,
    private offlineAccounting: OfflineAccountingTicketService,
  ) {}

  async listSales(dto: ListSalesDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.SalesInvoiceWhereInput = {
      ...(branchId ? { branch_id: branchId } : {}),
      ...(dto.payment_method ? { payment_method: dto.payment_method } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.from || dto.to ? { occurred_at: { ...(dto.from ? { gte: new Date(dto.from) } : {}), ...(dto.to ? { lte: this.endOfDay(dto.to) } : {}) } } : {}),
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
          payment_method: true, language: true, sync_id: true,
          shift_id: true, offline_session_id: true, terminal_sequence: true,
          occurred_at: true, received_at: true, created_at: true,
          _count: { select: { items: true, original_returns: true } },
        },
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
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
        cashier: { select: { id: true, name: true, role: true } },
        seller: { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
        shift: true,
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

  private saleCommandFingerprint(
    dto: CreateSaleDto,
    terminalId: string,
    occurredAt: Date,
    normalized: ReturnType<SalesService['normalizeLines']>,
  ) {
    const canonicalMoney = (value: number | undefined) =>
      value === undefined ? null : moneyString(value);
    const payload = {
      v: 1,
      branch_id: dto.branch_id,
      terminal_id: terminalId,
      shift_id: dto.shift_id,
      origin_cashier_id: dto.origin_cashier_id,
      seller_id: dto.seller_id,
      offline_session_id: dto.offline_session_id,
      terminal_sequence: dto.terminal_sequence,
      occurred_at: occurredAt.toISOString(),
      customer_phone: dto.customer_phone || null,
      payment_method: dto.payment_method,
      language: dto.language || 'ar',
      local_total: canonicalMoney(dto.local_total),
      accounting_token_hash: createHash('sha256')
        .update(dto.offline_accounting_token)
        .digest('hex'),
      pricing_mode: normalized.mode,
      items: normalized.lines
        .map((item) => ({
          variant_id: item.variant_id,
          qty: item.qty,
          unit_price: canonicalMoney(item.unit_price),
          unit_tax: canonicalMoney(item.unit_tax),
          price_version: item.price_version || null,
          price_token: item.price_token || null,
        }))
        .sort((left, right) => left.variant_id.localeCompare(right.variant_id)),
    };
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
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

  async createSale(
    dto: CreateSaleDto,
    actor: AuthenticatedUser,
    terminal: Pick<PosTerminal, 'id' | 'branch_id'>,
  ) {
    if (actor.role !== 'owner' && actor.branch_id !== dto.branch_id) {
      throw new ForbiddenException('You cannot create a sale for another branch');
    }
    if (!terminal || terminal.branch_id !== dto.branch_id) {
      throw new ForbiddenException('The terminal is not assigned to the sale branch');
    }

    const receivedAt = new Date();
    const occurredAt = new Date(dto.occurred_at);
    const terminalSequence = BigInt(dto.terminal_sequence);
    if (terminalSequence < 1n || terminalSequence > 9_223_372_036_854_775_807n) {
      throw new BadRequestException('terminal_sequence exceeds PostgreSQL BIGINT range');
    }
    const accountingClaims = this.offlineAccounting.verifySaleContext({
      token: dto.offline_accounting_token,
      offline_session_id: dto.offline_session_id,
      origin_cashier_id: dto.origin_cashier_id,
      branch_id: dto.branch_id,
      terminal_id: terminal.id,
      shift_id: dto.shift_id,
      occurred_at: occurredAt,
      received_at: receivedAt,
    });

    const normalized = this.normalizeLines(dto.items);
    const commandFingerprint = this.saleCommandFingerprint(
      dto,
      terminal.id,
      occurredAt,
      normalized,
    );
    if (normalized.mode === 'legacy' && dto.local_total === undefined) {
      throw new UnprocessableEntityException({
        code: 'LEGACY_LOCAL_TOTAL_REQUIRED',
        message_ar: 'العملية القديمة لا تحتوي إجماليًا محليًا موثوقًا وتحتاج مراجعة يدوية.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findUnique({
        where: { sync_id: dto.sync_id },
        include: { items: true },
      });
      if (existing) {
        if (
          existing.branch_id !== dto.branch_id ||
          existing.terminal_id !== terminal.id ||
          existing.shift_id !== dto.shift_id ||
          existing.cashier_id !== dto.origin_cashier_id ||
          existing.seller_id !== dto.seller_id ||
          existing.offline_session_id !== dto.offline_session_id ||
          existing.terminal_sequence !== terminalSequence ||
          existing.command_fingerprint !== commandFingerprint
        ) {
          throw new ConflictException({
            code: 'SALE_IDEMPOTENCY_CONTEXT_CONFLICT',
            message_ar: 'رقم المزامنة مستخدم لعملية مختلفة في الهوية أو الوردية أو الجهاز.',
            message: 'sync_id already belongs to a different accounting context',
          });
        }
        return existing;
      }

      const [branch, shift, originCashier, seller, sequenceOwner] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branch_id } }),
        tx.shift.findUnique({ where: { id: dto.shift_id } }),
        tx.user.findUnique({
          where: { id: dto.origin_cashier_id },
          select: { id: true },
        }),
        tx.user.findUnique({
          where: { id: dto.seller_id },
          select: { id: true, branch_id: true, role: true },
        }),
        tx.salesInvoice.findFirst({
          where: {
            terminal_id: terminal.id,
            terminal_sequence: terminalSequence,
          },
          select: { id: true, sync_id: true },
        }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      // Historical attribution is taken from the signed ticket. A legitimate
      // offline sale must remain syncable when the original cashier is later
      // disabled, moved to another branch, or assigned a different role.
      if (!originCashier || accountingClaims.user_id !== originCashier.id) {
        throw new UnprocessableEntityException({
          code: 'OFFLINE_ORIGIN_CASHIER_INVALID',
          message_ar: 'تعذر إثبات هوية الكاشير الأصلي لهذه العملية.',
          message: 'The original cashier cannot be validated',
        });
      }
      if (
        !seller ||
        seller.role !== 'seller' ||
        seller.branch_id !== dto.branch_id
      ) {
        throw new UnprocessableEntityException({
          code: 'SALE_SELLER_INVALID',
          message_ar: 'البائع المحدد غير موجود أو لا يتبع فرع الفاتورة.',
          message: 'The selected seller is invalid for this branch',
        });
      }
      if (!shift || shift.branch_id !== dto.branch_id) {
        throw new UnprocessableEntityException({
          code: 'OFFLINE_SHIFT_INVALID',
          message_ar: 'الوردية الموقعة غير موجودة أو لا تتبع فرع العملية.',
          message: 'The signed shift is invalid for this branch',
        });
      }
      if (!['open', 'closed'].includes(shift.status)) {
        throw new UnprocessableEntityException({
          code: 'OFFLINE_SHIFT_STATE_INVALID',
          message_ar: 'حالة الوردية الموقعة لا تسمح باستقبال عمليات بيع.',
          message: 'The signed shift state cannot accept sales',
        });
      }
      if (
        shift.status === 'closed' &&
        dto.payment_method === 'cash' &&
        (shift.expected_cash === null || shift.difference === null)
      ) {
        throw new ConflictException({
          code: 'OFFLINE_SHIFT_RECONCILIATION_UNAVAILABLE',
          message_ar: 'بيانات إغلاق الوردية غير مكتملة، لذلك لا يمكن إضافة عملية نقدية متأخرة دون مراجعة محاسبية.',
          message: 'Closed shift reconciliation values are missing',
        });
      }
      const skew = this.offlineAccounting.clockSkewMs;
      if (
        occurredAt.getTime() < shift.opened_at.getTime() - skew ||
        (shift.closed_at && occurredAt.getTime() > shift.closed_at.getTime() + skew)
      ) {
        throw new UnprocessableEntityException({
          code: 'OFFLINE_SALE_OUTSIDE_SHIFT',
          message_ar: 'وقت البيع خارج حدود الوردية الموقعة.',
          message: 'The sale occurred outside the signed shift window',
        });
      }
      if (sequenceOwner) {
        throw new ConflictException({
          code: 'TERMINAL_SEQUENCE_CONFLICT',
          message_ar: 'رقم ترتيب العملية مستخدم بالفعل لعملية أخرى على هذا الجهاز.',
          message: 'Terminal sequence already belongs to another sale',
        });
      }

      const previousSequence = terminalSequence - 1n;
      const sequenceClaim = await tx.posTerminal.updateMany({
        where: {
          id: terminal.id,
          branch_id: dto.branch_id,
          last_sale_sequence: previousSequence,
        },
        data: { last_sale_sequence: terminalSequence },
      });
      if (sequenceClaim.count !== 1) {
        throw new ConflictException({
          code: 'TERMINAL_SEQUENCE_OUT_OF_ORDER',
          message_ar: 'ترتيب العمليات المحلية غير متصل. أوقف البيع وراجع العمليات المعلقة على الجهاز.',
          message: 'Terminal sale sequence is not the next expected value',
          terminal_sequence: dto.terminal_sequence,
        });
      }

      const variantIds = normalized.lines.map((item) => item.variant_id);
      const variants = await tx.productVariant.findMany({
        where: {
          id: { in: variantIds },
          ...(normalized.mode === 'legacy'
            ? { product: { is_active: true } }
            : {}),
        },
        include: { product: true },
      });
      if (variants.length !== variantIds.length) {
        const found = new Set(variants.map((variant) => variant.id));
        const missing = variantIds.find((id) => !found.has(id));
        throw new NotFoundException(`Variant not found: ${missing}`);
      }
      const variantsById = new Map<string, any>(
        variants.map((variant: any) => [variant.id, variant]),
      );
      const currentQuotes = normalized.mode === 'legacy'
        ? await this.pricing.calculateMany(variants, tx)
        : null;
      const acceptedSnapshots: Array<{
        variant_id: string;
        price_version: string;
        issued_at: string;
      }> = [];

      const saleItems = normalized.lines.map((line) => {
        const variant = variantsById.get(line.variant_id)!;
        let unitPrice: Prisma.Decimal;
        let unitTax: Prisma.Decimal;
        if (normalized.mode === 'signed') {
          const claims = this.priceSnapshots.verify({
            branch_id: dto.branch_id,
            variant_id: line.variant_id,
            unit_price: line.unit_price!,
            unit_tax: line.unit_tax!,
            price_version: line.price_version!,
            price_token: line.price_token!,
          });
          unitPrice = money(line.unit_price!);
          unitTax = money(line.unit_tax!);
          acceptedSnapshots.push({
            variant_id: line.variant_id,
            price_version: claims.price_version,
            issued_at: claims.issued_at,
          });
        } else {
          const quote = currentQuotes!.get(line.variant_id)!;
          unitPrice = money(quote.net_price);
          unitTax = money(quote.tax_amount);
        }
        return {
          variant_id: line.variant_id,
          qty: line.qty,
          unit_price: unitPrice,
          unit_cost: money(variant.cost_price),
          tax: unitTax,
        };
      });

      const subtotal = sumMoney(
        saleItems.map((item) => lineMoney(item.unit_price, item.qty)),
      );
      const taxAmount = sumMoney(
        saleItems.map((item) => lineMoney(item.tax, item.qty)),
      );
      const total = money(subtotal.plus(taxAmount));

      if (
        dto.local_total !== undefined &&
        !sameMoney(dto.local_total, total)
      ) {
        throw new UnprocessableEntityException({
          code: normalized.mode === 'legacy'
            ? 'LEGACY_PRICE_RECONCILIATION_REQUIRED'
            : 'LOCAL_TOTAL_MISMATCH',
          message_ar: normalized.mode === 'legacy'
            ? 'فاتورة قديمة معلقة تختلف عن السعر الحالي وتحتاج مراجعة يدوية دون تغيير المبلغ المدفوع.'
            : 'إجمالي الفاتورة المحلية لا يطابق لقطات الأسعار الموقعة.',
          local_total: dto.local_total,
          server_total: moneyNumber(total),
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
        if (changed !== 1) {
          throw new ConflictException(
            `Insufficient stock for variant ${item.variant_id}`,
          );
        }
      }

      let customerId: string | undefined;
      if (dto.customer_phone) {
        const customer = await tx.customer.upsert({
          where: { phone: dto.customer_phone },
          update: {},
          create: {
            phone: dto.customer_phone,
            whatsapp: dto.customer_phone,
          },
        });
        customerId = customer.id;
      }

      const invoiceNumber =
        `B-${branch.code}-${receivedAt.getTime()}-${randomUUID().slice(0, 8)}`;
      const invoice = await tx.salesInvoice.create({
        data: {
          invoice_number: invoiceNumber,
          branch_id: dto.branch_id,
          customer_id: customerId,
          cashier_id: dto.origin_cashier_id,
          seller_id: dto.seller_id,
          received_by: actor.sub,
          terminal_id: terminal.id,
          shift_id: dto.shift_id,
          offline_session_id: dto.offline_session_id,
          terminal_sequence: terminalSequence,
          command_fingerprint: commandFingerprint,
          occurred_at: occurredAt,
          received_at: receivedAt,
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

      await tx.auditLog.create({
        data: {
          user_id: actor.sub,
          action: normalized.mode === 'signed'
            ? 'sale.offline_accounting.accepted'
            : 'sale.legacy_price.accepted',
          entity: 'SalesInvoice',
          entity_id: invoice.id,
          meta: {
            sync_id: dto.sync_id,
            local_total: dto.local_total ?? null,
            invoice_total: total,
            pricing_mode: normalized.mode,
            origin_cashier_id: dto.origin_cashier_id,
            seller_id: dto.seller_id,
            received_by: actor.sub,
            terminal_id: terminal.id,
            terminal_sequence: dto.terminal_sequence,
            command_fingerprint: commandFingerprint,
            shift_id: dto.shift_id,
            offline_session_id: dto.offline_session_id,
            occurred_at: dto.occurred_at,
            received_at: receivedAt.toISOString(),
            snapshots: acceptedSnapshots,
          },
        },
      });

      // A sale may legitimately arrive after its shift was closed because the
      // till was offline. Keep the immutable close count, but reconcile the
      // stored expected cash and variance so the closed shift remains
      // financially correct instead of silently omitting the late command.
      if (shift.status === 'closed' && dto.payment_method === 'cash') {
        // Atomic Decimal updates prevent two late tills from overwriting each
        // other's shift reconciliation when they reconnect concurrently.
        await tx.shift.update({
          where: { id: shift.id },
          data: {
            expected_cash: { increment: total },
            difference: { decrement: total },
          },
        });
        await tx.auditLog.create({
          data: {
            user_id: actor.sub,
            action: 'shift.late_offline_sale.reconciled',
            entity: 'Shift',
            entity_id: shift.id,
            meta: {
              invoice_id: invoice.id,
              sync_id: dto.sync_id,
              terminal_sequence: dto.terminal_sequence,
              expected_cash_increment: total,
              difference_decrement: total,
            },
          },
        });
      }

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

      let shiftId: string | null = null;
      if (actor.role !== 'owner') {
        const currentShift = await tx.shift.findFirst({
          where: { branch_id: original.branch_id, status: 'open' },
          select: { id: true },
        });
        if (!currentShift) {
          throw new ConflictException('An open shift is required to record a POS return');
        }
        shiftId = currentShift.id;
      }

      const saleOccurredAt = original.occurred_at || original.created_at;
      const ageDays = (Date.now() - saleOccurredAt.getTime()) / 86_400_000;
      if (ageDays > 14) {
        throw new BadRequestException('Return window expired (14 days)');
      }

      const returnItems: {
        sales_invoice_item_id: string;
        variant_id: string;
        qty: number;
        unit_price: Prisma.Decimal;
        unit_cost: Prisma.Decimal;
        unit_tax: Prisma.Decimal;
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

        let unitTax = money(soldItem.unit_tax);
        if (unitTax.isZero() && decimal(original.subtotal).gt(0)) {
          unitTax = money(
            decimal(soldItem.unit_price)
              .mul(original.tax_amount)
              .div(original.subtotal),
          );
        }

        returnItems.push({
          sales_invoice_item_id: saleItemId,
          variant_id: soldItem.variant_id,
          qty,
          unit_price: money(soldItem.unit_price),
          unit_cost: money(soldItem.unit_cost),
          unit_tax: unitTax,
        });
      }

      const refundSubtotal = sumMoney(
        returnItems.map((item) => lineMoney(item.unit_price, item.qty)),
      );
      const refundTax = sumMoney(
        returnItems.map((item) => lineMoney(item.unit_tax, item.qty)),
      );
      const refundTotal = money(refundSubtotal.plus(refundTax));
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
          shift_id: shiftId,
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
        occurred_at: true,
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
