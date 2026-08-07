import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type {
  PriceBook,
  PriceBookEntry,
  PriceBookScope,
  PriceBookStatus,
  PriceEntryScopeType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface PriceBookFilters {
  readonly status?: PriceBookStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PriceBookEntryFilters {
  readonly priceBookId?: string;
  readonly scopeType?: PriceEntryScopeType;
  readonly statusActiveOnly?: boolean;
}

/**
 * WP-008 Phase B — tenant-scoped repository for `PriceBook`/`PriceBookEntry`,
 * same `findById(context,id)/list(context,filters)/save(context,aggregate)`
 * contract established in Phase A (Multi-tenancy Blueprint §29).
 */
@Injectable()
export class PriceBookRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<PriceBook | null> {
    return this.prisma.priceBook.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<PriceBook> {
    const book = await this.findById(context, id);
    if (!book) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Price Book ${id} not found.`);
    return book;
  }

  async list(
    context: TenantScope,
    filters: PriceBookFilters = {},
  ): Promise<{ rows: PriceBook[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const where: Prisma.PriceBookWhereInput = {
      tenant_id: context.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.priceBook.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.priceBook.count({ where }),
    ]);
    return { rows, total };
  }

  async create(
    context: TenantScope,
    data: {
      name: string;
      currency: string;
      scope: PriceBookScope;
      scopeRefId: string | null;
      isDefault: boolean;
      createdBy: string;
    },
  ): Promise<PriceBook> {
    return this.prisma.priceBook.create({
      data: {
        tenant_id: context.tenantId,
        name: data.name,
        currency: data.currency,
        scope: data.scope,
        scope_ref_id: data.scopeRefId,
        is_default: data.isDefault,
        created_by: data.createdBy,
        status: 'draft',
      },
    });
  }

  async updateDraftName(context: TenantScope, id: string, name: string): Promise<PriceBook> {
    await this.assertInTenant(context, id);
    return this.prisma.priceBook.update({ where: { id }, data: { name } });
  }

  /**
   * Applies a single lifecycle transition inside one write — the previous
   * `status` is part of the `updateMany` predicate, so a concurrent
   * transition (or a stale client retrying an already-applied one) affects
   * zero rows instead of racing (same pattern `offers.service.ts` uses for
   * `OfferSuggestion.status`).
   */
  async transition(
    context: TenantScope,
    id: string,
    fromStatuses: readonly PriceBookStatus[],
    toStatus: PriceBookStatus,
    data: Prisma.PriceBookUpdateInput,
  ): Promise<PriceBook> {
    const changed = await this.prisma.priceBook.updateMany({
      where: { id, tenant_id: context.tenantId, status: { in: [...fromStatuses] } },
      data: { ...data, status: toStatus },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Price Book ${id} not found.`);
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Price Book ${id} is "${current.status}"; expected one of [${fromStatuses.join(', ')}] to move to "${toStatus}".`,
      );
    }
    return this.assertInTenant(context, id);
  }

  /**
   * BR-PRB-104: activating a new default book for the same
   * (currency, scope, scope_ref_id) ends the previous one — the previous
   * default is never left dangling as a phantom "active but not default"
   * book a caller could still accidentally price against.
   */
  async findCurrentDefault(
    context: TenantScope,
    currency: string,
    scope: PriceBookScope,
    scopeRefId: string | null,
  ): Promise<PriceBook | null> {
    return this.prisma.priceBook.findFirst({
      where: {
        tenant_id: context.tenantId,
        currency,
        scope,
        scope_ref_id: scopeRefId,
        is_default: true,
        status: 'active',
      },
    });
  }

  async endBook(
    context: TenantScope,
    id: string,
    actorId: string,
  ): Promise<PriceBook> {
    return this.transition(context, id, ['active'], 'ended', {
      ended_by: actorId,
      ended_at: new Date(),
      is_default: false,
    });
  }

  // --- PriceBookEntry (BR-PRB-102/103: versioned, no update path) --------

  async findEntryById(context: TenantScope, id: string): Promise<PriceBookEntry | null> {
    return this.prisma.priceBookEntry.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async assertEntryInTenant(context: TenantScope, id: string): Promise<PriceBookEntry> {
    const entry = await this.findEntryById(context, id);
    if (!entry) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Price Book entry ${id} not found.`);
    return entry;
  }

  async listEntries(
    context: TenantScope,
    filters: PriceBookEntryFilters = {},
  ): Promise<PriceBookEntry[]> {
    return this.prisma.priceBookEntry.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.priceBookId ? { price_book_id: filters.priceBookId } : {}),
        ...(filters.scopeType ? { scope_type: filters.scopeType } : {}),
        ...(filters.statusActiveOnly === false ? {} : { status: 'active' }),
      },
      orderBy: [{ scope_type: 'asc' }, { scope_id: 'asc' }, { min_qty: 'asc' }],
    });
  }

  async createEntry(
    context: TenantScope,
    data: {
      priceBookId: string;
      scopeType: PriceEntryScopeType;
      scopeId: string | null;
      minQty: Prisma.Decimal.Value;
      unitPrice: Prisma.Decimal.Value;
      allowZeroPrice: boolean;
      taxPercent: Prisma.Decimal.Value;
      floorPrice: Prisma.Decimal.Value | null;
      createdBy: string;
    },
  ): Promise<PriceBookEntry> {
    return this.prisma.priceBookEntry.create({
      data: {
        tenant_id: context.tenantId,
        price_book_id: data.priceBookId,
        scope_type: data.scopeType,
        scope_id: data.scopeId,
        min_qty: data.minQty,
        unit_price: data.unitPrice,
        allow_zero_price: data.allowZeroPrice,
        tax_percent: data.taxPercent,
        floor_price: data.floorPrice,
        version: 1,
        status: 'active',
        created_by: data.createdBy,
      },
    });
  }

  /**
   * BR-PRB-103: the only way to change an entry's price after creation.
   * Never mutates the previous row's price -- marks it "superseded" and
   * inserts a new version referencing it, in one transaction (same pattern as
   * Phase A's `UomRepository.supersedeConversion`).
   *
   * **Statement order matters.** `PriceBookEntry_one_active_per_scope_qty` is
   * a partial unique index over
   * `(price_book_id, scope_type, COALESCE(scope_id, ...), min_qty)
   *  WHERE status = 'active'`, and a non-deferrable unique index is checked
   * per statement, not at COMMIT. Inserting the successor first therefore
   * raised P2002 against a real database even though both writes are in one
   * transaction — so the previous row is demoted out of the partial index
   * *before* the successor is inserted. The successor's id is generated up
   * front so that demotion can record `superseded_by_id` in the same
   * statement rather than needing a third write.
   *
   * The demotion is an `updateMany` predicated on `status = 'active'`: two
   * callers superseding the same entry concurrently means exactly one sees
   * `count === 1` and the other is rejected, instead of both inserting a
   * successor.
   */
  async supersedeEntry(
    context: TenantScope,
    previousId: string,
    data: {
      unitPrice: Prisma.Decimal.Value;
      allowZeroPrice: boolean;
      taxPercent: Prisma.Decimal.Value;
      floorPrice: Prisma.Decimal.Value | null;
      createdBy: string;
    },
  ): Promise<PriceBookEntry> {
    const previous = await this.assertEntryInTenant(context, previousId);
    if (previous.status !== 'active') {
      throw new AthrDomainError(
        'PRICING_ENTRY_IMMUTABLE',
        `Price Book entry ${previousId} is already superseded; supersede its active successor instead.`,
      );
    }
    const nextId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const demoted = await tx.priceBookEntry.updateMany({
        where: { id: previous.id, tenant_id: context.tenantId, status: 'active' },
        data: { status: 'superseded', superseded_by_id: nextId, superseded_at: new Date() },
      });
      if (demoted.count !== 1) {
        throw new AthrDomainError(
          'PRICING_ENTRY_IMMUTABLE',
          `Price Book entry ${previousId} was superseded concurrently; supersede its active successor instead.`,
        );
      }
      return tx.priceBookEntry.create({
        data: {
          id: nextId,
          tenant_id: context.tenantId,
          price_book_id: previous.price_book_id,
          scope_type: previous.scope_type,
          scope_id: previous.scope_id,
          min_qty: previous.min_qty,
          unit_price: data.unitPrice,
          allow_zero_price: data.allowZeroPrice,
          tax_percent: data.taxPercent,
          floor_price: data.floorPrice,
          version: previous.version + 1,
          status: 'active',
          created_by: data.createdBy,
        },
      });
    });
  }
}
