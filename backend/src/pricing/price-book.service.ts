import { Injectable } from '@nestjs/common';
import { PriceBookRepository } from './price-book.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  CreatePriceBookDto,
  ListPriceBooksDto,
  SchedulePriceBookDto,
  UpdatePriceBookDraftDto,
} from './dto/price-book.dto';
import { CreatePriceEntryDto, SupersedePriceEntryDto } from './dto/price-book-entry.dto';
import type { PriceBookScope } from '@prisma/client';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * WP-008 Phase B (BR-PRB-1xx, Permission Matrix §17): the Price Book
 * maker-checker lifecycle. Each transition method enforces its own previous
 * status via `PriceBookRepository.transition` (repository-level, so a race
 * between two callers can never double-apply a transition); this service
 * layers the *business* checks a bare status check can't express —
 * self-approval, currency, and the "one default book" invariant.
 */
@Injectable()
export class PriceBookService {
  constructor(
    private readonly repository: PriceBookRepository,
    private readonly prisma: PrismaService,
    private readonly permissionPolicy: PermissionPolicyService,
  ) {}

  list(context: TenantContext, dto: ListPriceBooksDto) {
    return this.repository.list(context, { status: dto.status, page: dto.page, pageSize: dto.page_size });
  }

  findOne(context: TenantContext, id: string) {
    return this.repository.assertInTenant(context, id);
  }

  async create(context: TenantContext, actorId: string, dto: CreatePriceBookDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: context.tenantId } });
    if (!tenant) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tenant ${context.tenantId} not found.`);
    }
    // BR-PRB-100/OD-CAT-005: Phase B is single-operating-currency — a Price
    // Book's currency must equal the tenant's `default_currency`.
    const currency = dto.currency ?? tenant.default_currency;
    if (currency !== tenant.default_currency) {
      throw new AthrDomainError(
        'PRICING_CURRENCY_MISMATCH',
        `Price Book currency must be the tenant's operating currency ("${tenant.default_currency}"), not "${currency}".`,
      );
    }
    const scope = dto.scope ?? 'tenant_default';
    return this.asDefaultConflict(
      () =>
        this.repository.create(context, {
          name: dto.name,
          currency,
          scope,
          scopeRefId: dto.scope_ref_id ?? null,
          isDefault: dto.is_default ?? false,
          createdBy: actorId,
        }),
      `Another Price Book is already the active default for (${currency}, ${scope}, ${dto.scope_ref_id ?? 'tenant-wide'}). End or replace it via the lifecycle instead of flagging a second one.`,
    );
  }

  /**
   * BR-PRB-104: the "one active default per scope" partial unique index is a
   * real database constraint, so a collision surfaces as a raw Prisma P2002
   * unless it is translated. Callers get a domain error naming the conflict
   * (Error Catalog / CLAUDE.md §4) instead of a leaked ORM error code.
   */
  private asDefaultConflict<T>(operation: () => Promise<T>, message: string): Promise<T> {
    return this.asConflict(operation, 'PRICING_DEFAULT_PRICE_BOOK_CONFLICT', message);
  }

  private async asConflict<T>(
    operation: () => Promise<T>,
    code: 'PRICING_DEFAULT_PRICE_BOOK_CONFLICT' | 'PRICING_ENTRY_IMMUTABLE',
    message: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new AthrDomainError(code, message);
      }
      throw error;
    }
  }

  async updateDraft(context: TenantContext, id: string, dto: UpdatePriceBookDraftDto) {
    const book = await this.repository.assertInTenant(context, id);
    if (book.status !== 'draft') {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Price Book ${id} is "${book.status}"; only a "draft" book can be edited directly.`,
      );
    }
    return this.repository.updateDraftName(context, id, dto.name);
  }

  submit(context: TenantContext, actorId: string, id: string) {
    return this.repository.transition(context, id, ['draft'], 'submitted', {
      submitted_by: actorId,
      submitted_at: new Date(),
    });
  }

  /**
   * Permission Matrix §17 "Separation" / §63 (the mandatory SoD pair "Price
   * book creator" vs. approver): neither the *creator* nor the submitter may
   * approve.
   * Checking only `submitted_by` left the documented pair unguarded — create a
   * book, have a colleague submit it, approve your own book. §64: the check is
   * on identity, so a different session of the same identity does not satisfy
   * it either.
   */
  async approve(context: TenantContext, actorId: string, id: string) {
    const book = await this.repository.assertInTenant(context, id);
    if (book.created_by && book.created_by === actorId) {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
        `Price Book ${id} was created by this same actor; an independent approver is required.`,
      );
    }
    if (book.submitted_by && book.submitted_by === actorId) {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
        `Price Book ${id} was submitted by this same actor; an independent approver is required.`,
      );
    }
    return this.repository.transition(context, id, ['submitted'], 'approved', {
      approved_by: actorId,
      approved_at: new Date(),
    });
  }

  schedule(context: TenantContext, actorId: string, id: string, dto: SchedulePriceBookDto) {
    return this.repository.transition(context, id, ['approved'], 'scheduled', {
      scheduled_by: actorId,
      scheduled_at: new Date(),
      ...(dto.effective_from ? { effective_from: new Date(dto.effective_from) } : {}),
    });
  }

  /**
   * BR-PRB-104: activating a book flagged `is_default` ends whatever book
   * currently holds that default for the same (currency, scope,
   * scope_ref_id), atomically, so there is never a window with two "active
   * default" books nor zero.
   */
  async activate(context: TenantContext, actorId: string, id: string) {
    const book = await this.repository.assertInTenant(context, id);
    if (book.status !== 'scheduled') {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Price Book ${id} is "${book.status}"; expected "scheduled" to activate.`,
      );
    }

    // Two callers activating replacement defaults for the same scope race on
    // the same partial unique index; the loser must see the domain conflict,
    // not a raw P2002.
    return this.asDefaultConflict(
      () => this.activateInTransaction(context, actorId, id, book),
      `Another Price Book became the active default for (${book.currency}, ${book.scope}, ${book.scope_ref_id ?? 'tenant-wide'}) concurrently; re-read it and retry.`,
    );
  }

  private activateInTransaction(
    context: TenantContext,
    actorId: string,
    id: string,
    book: { id: string; is_default: boolean; currency: string; scope: PriceBookScope; scope_ref_id: string | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (book.is_default) {
        const previousDefault = await tx.priceBook.findFirst({
          where: {
            tenant_id: context.tenantId,
            currency: book.currency,
            scope: book.scope,
            scope_ref_id: book.scope_ref_id,
            is_default: true,
            status: 'active',
            id: { not: book.id },
          },
        });
        if (previousDefault) {
          await tx.priceBook.update({
            where: { id: previousDefault.id },
            data: { status: 'ended', ended_by: actorId, ended_at: new Date(), is_default: false },
          });
        }
      }
      const changed = await tx.priceBook.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'scheduled' },
        data: { status: 'active', activated_by: actorId, activated_at: new Date() },
      });
      if (changed.count !== 1) {
        throw new AthrDomainError(
          'PRICING_PRICE_BOOK_INVALID_TRANSITION',
          `Price Book ${id} could not be activated — it was changed concurrently.`,
        );
      }
      return tx.priceBook.findFirst({ where: { id, tenant_id: context.tenantId } });
    });
  }

  end(context: TenantContext, actorId: string, id: string) {
    return this.repository.endBook(context, id, actorId);
  }

  // --- Entries -------------------------------------------------------------

  listEntries(context: TenantContext, priceBookId?: string) {
    return this.repository.listEntries(context, { priceBookId });
  }

  async createEntry(context: TenantContext, actor: AuthenticatedUser, dto: CreatePriceEntryDto) {
    const actorId = actor.sub;
    const book = await this.repository.assertInTenant(context, dto.price_book_id);
    await this.assertEntriesManageable(book.status, actor);
    if (dto.scope_type !== 'global' && !dto.scope_id) {
      throw new AthrDomainError(
        'REQUEST_FIELD_VALUE_INVALID',
        'scope_id is required unless scope_type is "global".',
      );
    }
    this.assertValidPrice(dto.unit_price, dto.allow_zero_price ?? false);
    // `PriceBookEntry_one_active_per_scope_qty` (a partial unique index over
    // book/scope/min_qty WHERE status = 'active') rejects a duplicate here.
    // Same treatment as the default-book index: a domain error naming the
    // conflict, never a leaked Prisma P2002 (CLAUDE.md §4).
    return this.asConflict(
      () =>
        this.repository.createEntry(context, {
          priceBookId: book.id,
          scopeType: dto.scope_type,
          scopeId: dto.scope_type === 'global' ? null : dto.scope_id!,
          minQty: dto.min_qty ?? 1,
          unitPrice: dto.unit_price,
          allowZeroPrice: dto.allow_zero_price ?? false,
          taxPercent: dto.tax_percent ?? 14,
          floorPrice: dto.floor_price ?? null,
          createdBy: actorId,
        }),
      'PRICING_ENTRY_IMMUTABLE',
      `This Price Book already has an active entry for scope "${dto.scope_type}" at min_qty ${dto.min_qty ?? 1}. Supersede it instead of creating a second one (BR-PRB-103).`,
    );
  }

  /**
   * BR-PRB-103: a new version of an existing entry. Any field the caller
   * omits is **inherited from the entry being superseded**, never reset to a
   * literal — a supersede that only moves `unit_price` must not silently drop
   * this entry's configured `floor_price` (BR-OVP-102) or reset its
   * `tax_percent` to the interim 14% default.
   */
  async supersedeEntry(
    context: TenantContext,
    actor: AuthenticatedUser,
    id: string,
    dto: SupersedePriceEntryDto,
  ) {
    const entry = await this.repository.assertEntryInTenant(context, id);
    const book = await this.repository.assertInTenant(context, entry.price_book_id);
    await this.assertEntriesManageable(book.status, actor);
    const allowZeroPrice = dto.allow_zero_price ?? entry.allow_zero_price;
    this.assertValidPrice(dto.unit_price, allowZeroPrice);
    return this.repository.supersedeEntry(context, id, {
      unitPrice: dto.unit_price,
      allowZeroPrice,
      taxPercent: dto.tax_percent ?? entry.tax_percent,
      floorPrice: dto.floor_price ?? entry.floor_price,
      createdBy: actor.sub,
    });
  }

  /**
   * BR-PRB-101/103 + Permission Matrix §17.
   *
   * A `draft` book is not live, so `pricing.price-entry.manage` alone is
   * enough to build it up. An `active` book **is** live: a write there changes
   * a customer-facing price the moment it commits, with none of the
   * submit/approve/schedule gating the book-level lifecycle applies. BR-PRB-103
   * requires such a change to create a new version (which `supersedeEntry`
   * does) but says nothing about who may make it — so entry mutation on a live
   * book additionally requires `pricing.price-book.activate`, the existing
   * Matrix §17 key for "authority to make prices live". No role gains a key
   * here; this only stops a holder of `price-entry.manage` alone from
   * repricing production.
   *
   * BR-PRB-1xx specifies neither of the two policies the review proposed
   * (per-entry approval workflow / draft-only) — a per-entry approval state
   * machine would be governance this repo's BR doc does not define, and
   * draft-only contradicts BR-PRB-103's "modifying an effective price creates
   * a new version". Flagged for Osama rather than resolved unilaterally
   * (CLAUDE.md §6).
   */
  private async assertEntriesManageable(status: string, actor: AuthenticatedUser) {
    if (status !== 'draft' && status !== 'active') {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Entries can only be managed on a "draft" or "active" Price Book (current status: "${status}").`,
      );
    }
    if (status !== 'active') return;
    const role = actor.membership_role ?? null;
    const canPublishLivePrices = role
      ? await this.permissionPolicy.hasPermission(role, 'pricing.price-book.activate')
      : false;
    if (!canPublishLivePrices) {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        'This Price Book is active; changing a live price additionally requires "pricing.price-book.activate".',
      );
    }
  }

  // BR-PSL-102/103: negative is never valid; zero requires the explicit allowance.
  private assertValidPrice(unitPrice: number, allowZeroPrice: boolean) {
    if (unitPrice < 0) {
      throw new AthrDomainError('PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED', 'unit_price must not be negative.');
    }
    if (unitPrice === 0 && !allowZeroPrice) {
      throw new AthrDomainError(
        'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED',
        'A zero unit_price requires allow_zero_price.',
      );
    }
  }
}
