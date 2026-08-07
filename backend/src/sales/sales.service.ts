import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deviceTenantContext } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { PosTerminal, Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { CreateSaleDto, CreateSaleItemDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { createHash, randomUUID } from 'crypto';
import { assertBranchAccess } from '../auth/branch-access';
import { ListSalesDto } from './dto/list-sales.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ListReturnsDto } from './dto/list-returns.dto';
import {
  getErrorMessage,
  getPrismaErrorCode,
  getSaleTransactionOptions,
  isExpiredSaleTransactionError,
} from './sale-transaction';
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
  private readonly logger = new Logger(SalesService.name);
  private readonly countCache = new Map<string, { expiresAt: number; value: Promise<number> }>();

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
  ) {}

  async listSales(context: TenantContext, dto: ListSalesDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.SalesInvoiceWhereInput = {
      tenant_id: context.tenantId,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(dto.payment_method ? { payment_method: dto.payment_method } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.has_warnings === 'true' ? { warning_codes: { isEmpty: false } } : {}),
      ...(dto.from || dto.to ? { occurred_at: { ...(dto.from ? { gte: new Date(dto.from) } : {}), ...(dto.to ? { lte: this.endOfDay(dto.to) } : {}) } } : {}),
      ...(q ? { OR: [
        { invoice_number: { contains: q, mode: 'insensitive' } },
        { customer: { phone: { contains: q } } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
      ] } : {}),
    };
    // The tenant is part of the cache key: keyed on the filters alone,
    // one tenant's result count would be served to another (Blueprint §125).
    const countKey = JSON.stringify({
      tenantId: context.tenantId,
      branchId,
      q,
      payment: dto.payment_method,
      status: dto.status,
      hasWarnings: dto.has_warnings,
      from: dto.from,
      to: dto.to,
    });
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
          event_version: true, warning_codes: true,
          cashier_name_snapshot: true, seller_name_snapshot: true,
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

  async getInvoice(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, tenant_id: context.tenantId },
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
    const canonicalMoney = (value: number) => moneyString(value);
    const payload = {
      v: dto.event_version,
      branch_id: dto.branch_id,
      terminal_id: terminalId,
      shift_id: dto.shift_id,
      origin_cashier_id: dto.origin_cashier_id,
      cashier_name_snapshot: dto.cashier_name_snapshot.trim(),
      seller_id: dto.seller_id,
      seller_name_snapshot: dto.seller_name_snapshot.trim(),
      offline_session_id: dto.offline_session_id,
      terminal_sequence: dto.terminal_sequence,
      occurred_at: occurredAt.toISOString(),
      customer_phone: dto.customer_phone || null,
      payment_method: dto.payment_method,
      language: dto.language || 'ar',
      local_total: canonicalMoney(dto.local_total),
      items: normalized.lines
        .map((item) => ({
          variant_id: item.variant_id,
          qty: item.qty,
          unit_price: canonicalMoney(item.unit_price),
          unit_tax: canonicalMoney(item.unit_tax),
          sku_snapshot: item.sku_snapshot.trim(),
          name_ar_snapshot: item.name_ar_snapshot.trim(),
          name_en_snapshot: item.name_en_snapshot?.trim() || null,
          size_snapshot: item.size_snapshot?.trim() || null,
          color_snapshot: item.color_snapshot?.trim() || null,
        }))
        .sort((left, right) => left.variant_id.localeCompare(right.variant_id)),
    };
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private normalizeLines(items: CreateSaleItemDto[]) {
    const lines = new Map<string, CreateSaleItemDto>();
    for (const item of items) {
      const existing = lines.get(item.variant_id);
      if (!existing) lines.set(item.variant_id, { ...item });
      else {
        if (
          !sameMoney(existing.unit_price, item.unit_price) ||
          !sameMoney(existing.unit_tax, item.unit_tax) ||
          existing.sku_snapshot.trim() !== item.sku_snapshot.trim() ||
          existing.name_ar_snapshot.trim() !== item.name_ar_snapshot.trim() ||
          (existing.name_en_snapshot?.trim() || '') !== (item.name_en_snapshot?.trim() || '') ||
          (existing.size_snapshot?.trim() || '') !== (item.size_snapshot?.trim() || '') ||
          (existing.color_snapshot?.trim() || '') !== (item.color_snapshot?.trim() || '')
        ) {
          throw new UnprocessableEntityException({
            code: 'CONFLICTING_ITEM_SNAPSHOTS',
            message_ar: 'الصنف نفسه يحمل بيانات تاريخية مختلفة داخل الفاتورة.',
            message: 'The same variant has conflicting historical snapshots',
          });
        }
        existing.qty += item.qty;
      }
    }
    return { lines: [...lines.values()] };
  }

  private async runSaleTransaction<T>(
    dto: CreateSaleDto,
    terminal: Pick<PosTerminal, 'id'>,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const options = getSaleTransactionOptions();
    const startedAt = Date.now();

    try {
      return await this.prisma.$transaction(operation, options);
    } catch (error: unknown) {
      const prismaCode = getPrismaErrorCode(error);
      const expired = isExpiredSaleTransactionError(error);

      if (expired || prismaCode) {
        this.logger.error(
          JSON.stringify({
            level: 'error',
            errorCode: expired
              ? 'SALE_TRANSACTION_EXPIRED'
              : 'SALE_DATABASE_OPERATION_FAILED',
            component: 'database',
            status: 'rolled_back',
            operation: 'create_sale',
            syncId: dto.sync_id,
            branchId: dto.branch_id,
            terminalId: terminal.id,
            terminalSequence: dto.terminal_sequence,
            itemCount: dto.items.length,
            prismaCode,
            elapsedMs: Date.now() - startedAt,
            maxWaitMs: options.maxWait,
            timeoutMs: options.timeout,
            message: expired
              ? 'The sale transaction expired before completion and was rolled back.'
              : 'The sale transaction failed during a database operation and was rolled back.',
            originalMessage: getErrorMessage(error),
          }),
          error instanceof Error ? error.stack : undefined,
        );
      }

      if (expired) {
        throw new ServiceUnavailableException({
          code: 'SALE_TRANSACTION_EXPIRED',
          retryable: true,
          retry_after_ms: 2_000,
          message_ar:
            'تعذر إتمام عملية البيع داخل مهلة قاعدة البيانات. أعد المحاولة بنفس رقم المزامنة.',
          message:
            'The sale transaction exceeded the database timeout and was rolled back. Retry using the same sync_id.',
        });
      }

      throw error;
    }
  }

  async createSale(
    dto: CreateSaleDto,
    terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>,
  ) {
    if (!terminal || terminal.branch_id !== dto.branch_id) {
      throw new ForbiddenException('The terminal is not assigned to the sale branch');
    }

    // WP-007 Phase A: this route is device-authenticated (@Public + PosProtocolGuard),
    // so there is no session for TenantContextGuard to work from. The tenant
    // comes from the enrolled terminal's own tenant_id, backfilled for every
    // existing terminal by WP-005 Phase B, and fails closed if absent. Reading
    // that existing column is not an enrollment change (Phase C, §A.4).
    const context = deviceTenantContext(terminal);

    const receivedAt = new Date();
    const occurredAt = new Date(dto.occurred_at);
    const terminalSequence = BigInt(dto.terminal_sequence);
    if (terminalSequence < 1n || terminalSequence > 9_223_372_036_854_775_807n) {
      throw new BadRequestException('terminal_sequence exceeds PostgreSQL BIGINT range');
    }
    const normalized = this.normalizeLines(dto.items);
    const commandFingerprint = this.saleCommandFingerprint(
      dto,
      terminal.id,
      occurredAt,
      normalized,
    );

    const result = await this.runSaleTransaction(dto, terminal, async (tx) => {
      const [lockedTerminal] = await tx.$queryRaw<Array<{
        id: string;
        branch_id: string;
        last_sale_sequence: bigint;
      }>>`
        SELECT "id", "branch_id", "last_sale_sequence"
        FROM "PosTerminal"
        WHERE "id" = ${terminal.id}::uuid
        FOR UPDATE
      `;
      if (!lockedTerminal || lockedTerminal.branch_id !== dto.branch_id) {
        throw new ForbiddenException('The terminal is not assigned to the sale branch');
      }

      const existing = await tx.salesInvoice.findFirst({
        where: { tenant_id: context.tenantId, sync_id: dto.sync_id },
        include: { items: true },
      });
      if (existing) {
        if (
          existing.branch_id !== dto.branch_id ||
          existing.terminal_id !== terminal.id ||
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

      const warningCodes = new Set<string>();
      const [branch, shift, originCashier, seller, sequenceOwner] = await Promise.all([
        tx.branch.findFirst({ where: { id: dto.branch_id, tenant_id: context.tenantId } }),
        tx.shift.findFirst({ where: { id: dto.shift_id, tenant_id: context.tenantId } }),
        // Identities are scoped through Membership — `User` has no tenant_id.
        tx.user.findFirst({
          where: {
            id: dto.origin_cashier_id,
            memberships: { some: { tenantId: context.tenantId } },
          },
          select: { id: true, branch_id: true, name: true },
        }),
        tx.user.findFirst({
          where: {
            id: dto.seller_id,
            memberships: { some: { tenantId: context.tenantId } },
          },
          select: { id: true, branch_id: true, role: true, name: true },
        }),
        tx.salesInvoice.findFirst({
          where: {
            tenant_id: context.tenantId,
            terminal_id: terminal.id,
            terminal_sequence: terminalSequence,
          },
          select: { id: true, sync_id: true },
        }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      const linkedCashier =
        originCashier?.branch_id === dto.branch_id ? originCashier : null;
      if (!linkedCashier) {
        warningCodes.add('CASHIER_REFERENCE_MISSING');
      }
      const linkedSeller =
        seller?.branch_id === dto.branch_id && seller.role === 'seller'
          ? seller
          : null;
      if (!linkedSeller) {
        warningCodes.add('SELLER_REFERENCE_MISSING');
      }
      const linkedShift = shift?.branch_id === dto.branch_id ? shift : null;
      if (!linkedShift) {
        warningCodes.add('SHIFT_REFERENCE_MISSING');
      } else if (
        linkedShift.status === 'closed' ||
        occurredAt < linkedShift.opened_at ||
        (linkedShift.closed_at && occurredAt > linkedShift.closed_at)
      ) {
        warningCodes.add('LATE_SYNC');
      }
      if (sequenceOwner) {
        throw new ConflictException({
          code: 'TERMINAL_SEQUENCE_CONFLICT',
          message_ar: 'رقم ترتيب العملية مستخدم بالفعل لعملية أخرى على هذا الجهاز.',
          message: 'Terminal sequence already belongs to another sale',
        });
      }

      if (terminalSequence > lockedTerminal.last_sale_sequence + 1n) {
        warningCodes.add('SEQUENCE_GAP');
      } else if (terminalSequence <= lockedTerminal.last_sale_sequence) {
        warningCodes.add('OUT_OF_ORDER_SEQUENCE');
      }

      const variantIds = normalized.lines.map((item) => item.variant_id);
      const variants = await tx.productVariant.findMany({
        where: {
          id: { in: variantIds },
          tenant_id: context.tenantId,
          product: { tenant_id: context.tenantId },
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
      // WP-008 Phase B: `calculateMany` now prices per (variant, qty) pair
      // (BR-PSL-104 quantity breaks) -- `normalized.lines` already merges
      // duplicate variant_ids into one line with a summed qty
      // (`normalizeLines`), so this is exactly one line per priced variant.
      const currentQuotes = await this.pricing.calculateMany(
        context,
        normalized.lines.map((line) => ({
          variant: variantsById.get(line.variant_id)!,
          qty: line.qty,
        })),
        tx,
      );

      const saleItems = normalized.lines.map((line) => {
        const variant = variantsById.get(line.variant_id)!;
        const quote = currentQuotes.get(line.variant_id)!;
        const unitPrice = money(line.unit_price);
        const unitTax = money(line.unit_tax);
        if (
          !sameMoney(unitPrice, quote.net_price) ||
          !sameMoney(unitTax, quote.tax_amount)
        ) {
          warningCodes.add('PRICE_VARIANCE');
        }
        return {
          variant_id: line.variant_id,
          qty: line.qty,
          unit_price: unitPrice,
          unit_cost: money(variant.cost_price),
          tax: unitTax,
          sku_snapshot: line.sku_snapshot.trim(),
          name_ar_snapshot: line.name_ar_snapshot.trim(),
          name_en_snapshot: line.name_en_snapshot?.trim() || null,
          size_snapshot: line.size_snapshot?.trim() || null,
          color_snapshot: line.color_snapshot?.trim() || null,
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
        !sameMoney(dto.local_total, total)
      ) {
        throw new UnprocessableEntityException({
          code: 'LOCAL_TOTAL_MISMATCH',
          message_ar: 'إجمالي الفاتورة لا يطابق مجموع سطورها المحفوظة محليًا.',
          message: 'The local invoice total does not match its immutable lines',
          local_total: dto.local_total,
          calculated_total: moneyNumber(total),
        });
      }

      const stockAfter = new Map<string, number>();
      for (const item of saleItems) {
        const stock = await tx.inventoryStock.upsert({
          where: {
            branch_id_variant_id: {
              branch_id: dto.branch_id,
              variant_id: item.variant_id,
            },
          },
          update: {
            qty_on_hand: { decrement: item.qty },
            last_sold_at: receivedAt,
          },
          create: {
            tenant_id: context.tenantId,
            branch_id: dto.branch_id,
            variant_id: item.variant_id,
            qty_on_hand: -item.qty,
            last_sold_at: receivedAt,
          },
        });
        stockAfter.set(item.variant_id, stock.qty_on_hand);
        if (stock.qty_on_hand - stock.qty_reserved < 0) {
          warningCodes.add('NEGATIVE_STOCK');
        }
      }

      let customerId: string | undefined;
      if (dto.customer_phone) {
        // `Customer.phone` is still globally unique until Phase B, so an
        // upsert keyed on phone alone would attach another tenant's customer
        // to this sale. Resolve within the tenant first, then create.
        const existingCustomer = await tx.customer.findFirst({
          where: { phone: dto.customer_phone, tenant_id: context.tenantId },
          select: { id: true },
        });
        const customer = existingCustomer ?? (await tx.customer.create({
          data: {
            tenant_id: context.tenantId,
            phone: dto.customer_phone,
            whatsapp: dto.customer_phone,
          },
          select: { id: true },
        }));
        customerId = customer.id;
      }

      const invoiceNumber =
        `B-${branch.code}-${receivedAt.getTime()}-${randomUUID().slice(0, 8)}`;
      const invoice = await tx.salesInvoice.create({
        data: {
          tenant_id: context.tenantId,
          invoice_number: invoiceNumber,
          event_version: dto.event_version,
          warning_codes: [...warningCodes].sort(),
          branch_id: dto.branch_id,
          customer_id: customerId,
          cashier_id: linkedCashier?.id || null,
          cashier_name_snapshot: dto.cashier_name_snapshot.trim(),
          seller_id: linkedSeller?.id || null,
          seller_name_snapshot: dto.seller_name_snapshot.trim(),
          received_by: linkedCashier?.id || null,
          terminal_id: terminal.id,
          shift_id: linkedShift?.id || null,
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
              sku_snapshot: item.sku_snapshot,
              name_ar_snapshot: item.name_ar_snapshot,
              name_en_snapshot: item.name_en_snapshot,
              size_snapshot: item.size_snapshot,
              color_snapshot: item.color_snapshot,
            })),
          },
        },
        include: { items: true },
      });

      const invoiceItemByVariant = new Map(
        invoice.items.map((item) => [item.variant_id, item]),
      );
      for (const item of saleItems) {
        const invoiceItem = invoiceItemByVariant.get(item.variant_id);
        if (!invoiceItem) {
          throw new NotFoundException(
            `Created sale line is missing for variant ${item.variant_id}`,
          );
        }
        await tx.$queryRaw`
          SELECT "record_inventory_movement"(
            ${dto.branch_id}::uuid,
            ${item.variant_id}::uuid,
            'sale'::"InventoryMovementType",
            ${-item.qty}::integer,
            0::integer,
            'SalesInvoice'::text,
            ${invoice.id}::text,
            ${invoiceItem.id}::text,
            ${`sale:${dto.sync_id}:${item.variant_id}`}::text,
            ${occurredAt}::timestamp,
            ${linkedCashier?.id || null}::uuid,
            ${JSON.stringify({
              sync_id: dto.sync_id,
              terminal_id: terminal.id,
              terminal_sequence: dto.terminal_sequence,
              qty_on_hand_after: stockAfter.get(item.variant_id),
            })}::jsonb
          )
        `;
      }

      if (terminalSequence > lockedTerminal.last_sale_sequence) {
        await tx.posTerminal.update({
          where: { id: terminal.id },
          data: { last_sale_sequence: terminalSequence },
        });
      }

      await tx.auditLog.create({
        data: {
          tenant_id: context.tenantId,
          user_id: linkedCashier?.id || null,
          action: warningCodes.size
            ? 'sale.accepted_with_warning'
            : 'sale.accepted',
          entity: 'SalesInvoice',
          entity_id: invoice.id,
          meta: {
            sync_id: dto.sync_id,
            event_version: dto.event_version,
            local_total: dto.local_total,
            invoice_total: total,
            warning_codes: [...warningCodes].sort(),
            origin_cashier_id: dto.origin_cashier_id,
            seller_id: dto.seller_id,
            terminal_id: terminal.id,
            terminal_sequence: dto.terminal_sequence,
            command_fingerprint: commandFingerprint,
            shift_id: dto.shift_id,
            offline_session_id: dto.offline_session_id,
            occurred_at: dto.occurred_at,
            received_at: receivedAt.toISOString(),
          },
        },
      });

      // A sale may legitimately arrive after its shift was closed because the
      // till was offline. Keep the immutable close count, but reconcile the
      // stored expected cash and variance so the closed shift remains
      // financially correct instead of silently omitting the late command.
      if (
        linkedShift?.status === 'closed' &&
        dto.payment_method === 'cash' &&
        linkedShift.expected_cash !== null &&
        linkedShift.difference !== null
      ) {
        // Atomic Decimal updates prevent two late tills from overwriting each
        // other's shift reconciliation when they reconnect concurrently.
        await tx.shift.update({
          where: { id: linkedShift.id },
          data: {
            expected_cash: { increment: total },
            difference: { decrement: total },
          },
        });
        await tx.auditLog.create({
          data: {
            tenant_id: context.tenantId,
            user_id: linkedCashier?.id || null,
            action: 'shift.late_offline_sale.reconciled',
            entity: 'Shift',
            entity_id: linkedShift.id,
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

  async createReturn(context: TenantContext, dto: CreateReturnDto, actor: AuthenticatedUser) {
    const requested = new Map<string, number>();
    for (const item of dto.items) {
      requested.set(
        item.sales_invoice_item_id,
        (requested.get(item.sales_invoice_item_id) || 0) + item.qty,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const original = await tx.salesInvoice.findFirst({
        where: { tenant_id: context.tenantId, id: dto.original_invoice_id },
        include: { items: true },
      });
      if (!original) throw new NotFoundException('Original invoice not found');
      if (actor.role !== 'owner' && actor.branch_id !== original.branch_id) {
        throw new ForbiddenException('You cannot return a sale from another branch');
      }

      let shiftId: string | null = null;
      if (actor.role !== 'owner') {
        const currentShift = await tx.shift.findFirst({
          where: {
            tenant_id: context.tenantId, branch_id: original.branch_id, status: 'open' },
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
            tenant_id: context.tenantId,
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
          tenant_id: context.tenantId,
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
            tenant_id: context.tenantId,
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
        const customer = await tx.customer.findFirst({
          where: { tenant_id: context.tenantId, id: original.customer_id },
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

  async findReturnableInvoice(context: TenantContext, reference: string, actor: AuthenticatedUser) {
    const byId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        reference,
      );
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: {
        tenant_id: context.tenantId,
        ...(byId ? { id: reference } : { invoice_number: reference }),
      },
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

  async listReturns(context: TenantContext, dto: ListReturnsDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.ReturnWhereInput = {
      tenant_id: context.tenantId,
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
