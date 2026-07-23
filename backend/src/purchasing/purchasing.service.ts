import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import {
  CreateSupplierReturnDto,
  ReceivePurchaseDto,
  ReversePurchaseDto,
} from './dto/receive-purchase.dto'
import { AuthenticatedUser } from '../auth/authenticated-user'
import {
  PreparedPurchaseReceipt,
  calculateSupplierReturnCredit,
  preparePurchaseReceipt,
} from './purchasing-accounting'

const purchaseInclude = {
  branch: true,
  supplier: true,
  creator: {
    select: { id: true, name: true, role: true },
  },
  reverser: {
    select: { id: true, name: true, role: true },
  },
  items: {
    include: {
      variant: { include: { product: true } },
    },
  },
  cost_movements: {
    orderBy: { sequence: 'asc' as const },
  },
  supplier_returns: {
    include: {
      creator: {
        select: { id: true, name: true, role: true },
      },
      items: {
        include: {
          variant: { include: { product: true } },
        },
      },
    },
    orderBy: { occurred_at: 'desc' as const },
  },
} satisfies Prisma.PurchaseInvoiceInclude

@Injectable()
export class PurchasingService {
  constructor(private prisma: PrismaService) {}

  list(branch_id?: string, take = 50) {
    const safeTake = Math.min(200, Math.max(1, Number(take) || 50))
    return this.prisma.purchaseInvoice.findMany({
      where: branch_id ? { branch_id } : {},
      include: {
        branch: true,
        supplier: true,
        creator: { select: { id: true, name: true, role: true } },
        items: { include: { variant: { include: { product: true } } } },
      },
      orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
      take: safeTake,
    })
  }

  get(id: string) {
    return this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: purchaseInclude,
    })
  }

  async receive(dto: ReceivePurchaseDto, actor: AuthenticatedUser) {
    if (
      dto.discount_amount !== undefined &&
      dto.discount_percent !== undefined
    ) {
      throw new BadRequestException(
        'Use either discount_amount or discount_percent, not both',
      )
    }

    let prepared: PreparedPurchaseReceipt
    try {
      prepared = preparePurchaseReceipt(dto)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid purchase receipt',
      )
    }

    if (
      actor.role !== 'owner' &&
      actor.role !== 'warehouse_manager' &&
      actor.branch_id !== dto.branch_id
    ) {
      throw new ForbiddenException(
        'You cannot receive stock for another branch',
      )
    }

    const receivedAt = dto.received_at
      ? new Date(dto.received_at)
      : new Date()
    if (
      Number.isNaN(receivedAt.getTime()) ||
      receivedAt.getTime() > Date.now() + 300_000
    ) {
      throw new BadRequestException(
        'received_at must be a valid time that is not in the future',
      )
    }

    try {
      return await this.serializable(async (tx) => {
        const replay = await this.findReplay(
          tx,
          prepared,
          dto.supplier_id,
        )
        if (replay) return replay

        const [branch, supplier] = await Promise.all([
          tx.branch.findFirst({
            where: { id: dto.branch_id, is_active: true },
            select: { id: true },
          }),
          tx.supplier.findUnique({
            where: { id: dto.supplier_id },
            select: { id: true },
          }),
        ])
        if (!branch) throw new NotFoundException('Active branch not found')
        if (!supplier) throw new NotFoundException('Supplier not found')

        const variantIds = prepared.lines
          .map((line) => line.variant_id)
          .sort()
        await this.lockVariants(tx, variantIds)

        const variants = await tx.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true },
        })
        if (variants.length !== variantIds.length) {
          throw new NotFoundException(
            'One or more product variants were not found',
          )
        }

        const invoice = await tx.purchaseInvoice.create({
          data: {
            supplier_id: dto.supplier_id,
            branch_id: dto.branch_id,
            invoice_number: dto.invoice_number?.trim() || null,
            normalized_invoice_number:
              prepared.normalizedInvoiceNumber,
            invoice_date: dto.invoice_date
              ? new Date(dto.invoice_date)
              : undefined,
            status: 'posted',
            accounting_version: 2,
            idempotency_key: prepared.idempotencyKey,
            command_fingerprint: prepared.commandFingerprint,
            subtotal: prepared.subtotal,
            discount_amount: prepared.discount,
            discount_percent: dto.discount_percent || 0,
            total: prepared.total,
            ocr_source_file: dto.ocr_source_file,
            received_at: receivedAt,
            created_by: actor.sub,
            items: {
              create: prepared.lines.map((line) => ({
                variant_id: line.variant_id,
                qty: line.qty,
                unit_cost: line.unit_cost,
                line_subtotal: line.line_subtotal,
                allocated_discount: line.allocated_discount,
                net_line_total: line.net_line_total,
                net_unit_cost: line.net_unit_cost,
              })),
            },
          },
          include: { items: true },
        })

        const itemByVariant = new Map<
          string,
          { id: string; variant_id: string }
        >(
          invoice.items.map((item) => [
            item.variant_id,
            { id: item.id, variant_id: item.variant_id },
          ]),
        )

        for (const line of prepared.lines) {
          const invoiceItem = itemByVariant.get(line.variant_id)
          if (!invoiceItem) {
            throw new NotFoundException(
              `Created purchase line is missing for variant ${line.variant_id}`,
            )
          }

          await tx.inventoryStock.upsert({
            where: {
              branch_id_variant_id: {
                branch_id: dto.branch_id,
                variant_id: line.variant_id,
              },
            },
            update: { qty_on_hand: { increment: line.qty } },
            create: {
              branch_id: dto.branch_id,
              variant_id: line.variant_id,
              qty_on_hand: line.qty,
            },
          })

          await tx.$queryRaw`
            SELECT "record_inventory_movement"(
              ${dto.branch_id}::uuid,
              ${line.variant_id}::uuid,
              'purchase_receipt'::"InventoryMovementType",
              ${line.qty}::integer,
              0::integer,
              'PurchaseInvoice'::text,
              ${invoice.id}::text,
              ${invoiceItem.id}::text,
              ${`purchase-receipt:${invoiceItem.id}`}::text,
              ${receivedAt}::timestamp,
              ${actor.sub}::uuid,
              ${JSON.stringify({
                supplier_id: dto.supplier_id,
                invoice_number: dto.invoice_number || null,
                net_line_total: line.net_line_total.toFixed(2),
                net_unit_cost: line.net_unit_cost.toFixed(6),
              })}::jsonb
            )
          `

          await tx.$queryRaw`
            SELECT "record_inventory_cost_movement"(
              ${line.variant_id}::uuid,
              ${dto.branch_id}::uuid,
              'purchase_receipt'::"InventoryCostMovementType",
              ${line.qty}::integer,
              ${line.net_line_total.toFixed(2)}::numeric,
              'PurchaseInvoice'::text,
              ${invoice.id}::text,
              ${invoiceItem.id}::text,
              ${invoice.id}::uuid,
              ${invoiceItem.id}::uuid,
              NULL::uuid,
              NULL::uuid,
              ${`purchase-cost:${invoiceItem.id}`}::text,
              ${receivedAt}::timestamp,
              ${actor.sub}::uuid,
              NULL::numeric,
              ${JSON.stringify({
                supplier_id: dto.supplier_id,
                invoice_number: dto.invoice_number || null,
                gross_line_total: line.line_subtotal.toFixed(2),
                allocated_discount:
                  line.allocated_discount.toFixed(2),
              })}::jsonb
            )
          `

        }

        await tx.auditLog.create({
          data: {
            user_id: actor.sub,
            action: 'purchase.receipt.posted',
            entity: 'PurchaseInvoice',
            entity_id: invoice.id,
            meta: {
              accounting_version: 2,
              idempotency_key: prepared.idempotencyKey,
              command_fingerprint: prepared.commandFingerprint,
              supplier_id: dto.supplier_id,
              branch_id: dto.branch_id,
              invoice_number: dto.invoice_number || null,
              normalized_invoice_number:
                prepared.normalizedInvoiceNumber,
              subtotal: prepared.subtotal.toFixed(2),
              discount: prepared.discount.toFixed(2),
              total: prepared.total.toFixed(2),
              received_at: receivedAt.toISOString(),
            },
          },
        })

        return tx.purchaseInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: purchaseInclude,
        })
      })
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const replay = await this.findReplay(
          this.prisma,
          prepared,
          dto.supplier_id,
        )
        if (replay) return replay
        throw new ConflictException(
          'Supplier invoice number or purchase command was already used',
        )
      }
      throw error
    }
  }


  async returnToSupplier(
    invoiceId: string,
    dto: CreateSupplierReturnDto,
    actor: AuthenticatedUser,
  ) {
    if (!dto.command_id) {
      throw new BadRequestException(
        'command_id is required for supplier returns',
      )
    }
    const reason = dto.reason.trim()
    if (!reason) {
      throw new BadRequestException('Supplier return reason is required')
    }

    const occurredAt = dto.occurred_at
      ? new Date(dto.occurred_at)
      : new Date()
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.getTime() > Date.now() + 300_000
    ) {
      throw new BadRequestException(
        'occurred_at must be a valid time that is not in the future',
      )
    }

    const requested = new Map<string, number>()
    for (const item of dto.items) {
      const next =
        (requested.get(item.purchase_invoice_item_id) || 0) +
        item.qty
      if (
        !Number.isSafeInteger(next) ||
        next > 2_147_483_647
      ) {
        throw new BadRequestException(
          'Supplier return quantity exceeds supported range',
        )
      }
      requested.set(item.purchase_invoice_item_id, next)
    }
    const canonicalItems = [...requested.entries()]
      .map(([purchase_invoice_item_id, qty]) => ({
        purchase_invoice_item_id,
        qty,
      }))
      .sort((left, right) =>
        left.purchase_invoice_item_id.localeCompare(
          right.purchase_invoice_item_id,
        ),
      )
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          purchase_invoice_id: invoiceId,
          reason,
          occurred_at: dto.occurred_at
            ? occurredAt.toISOString()
            : null,
          items: canonicalItems,
        }),
      )
      .digest('hex')
    const idempotencyKey = `supplier-return:${dto.command_id}`

    try {
      return await this.serializable(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "PurchaseInvoice"
          WHERE "id" = ${invoiceId}::uuid
          FOR UPDATE
        `

        const replay = await tx.supplierReturn.findUnique({
          where: { idempotency_key: idempotencyKey },
          include: {
            purchase_invoice: true,
            supplier: true,
            branch: true,
            creator: {
              select: { id: true, name: true, role: true },
            },
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
            cost_movements: {
              orderBy: { sequence: 'asc' },
            },
          },
        })
        if (replay) {
          if (replay.command_fingerprint !== fingerprint) {
            throw new ConflictException(
              'Supplier return command belongs to different return data',
            )
          }
          return replay
        }

        const invoice = await tx.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          include: { items: true },
        })
        if (!invoice) {
          throw new NotFoundException('Purchase invoice not found')
        }
        if (invoice.status !== 'posted') {
          throw new ConflictException(
            'Supplier returns require a posted purchase invoice',
          )
        }
        if (
          invoice.accounting_version < 2 &&
          new Prisma.Decimal(invoice.discount_amount).greaterThan(0)
        ) {
          throw new ConflictException(
            'A discounted legacy purchase has no reproducible line allocation and requires manual accounting review',
          )
        }
        if (
          actor.role !== 'owner' &&
          actor.role !== 'warehouse_manager' &&
          actor.branch_id !== invoice.branch_id
        ) {
          throw new ForbiddenException(
            'You cannot return stock for another branch',
          )
        }

        type PurchaseLine = {
          id: string
          variant_id: string
          qty: number
          unit_cost: Prisma.Decimal
          net_unit_cost: Prisma.Decimal | null
          net_line_total: Prisma.Decimal | null
        }
        const invoiceItemById = new Map<string, PurchaseLine>(
          invoice.items.map((item) => [
            item.id,
            {
              id: item.id,
              variant_id: item.variant_id,
              qty: item.qty,
              unit_cost: item.unit_cost,
              net_unit_cost: item.net_unit_cost,
              net_line_total: item.net_line_total,
            },
          ]),
        )
        for (const request of canonicalItems) {
          if (!invoiceItemById.has(request.purchase_invoice_item_id)) {
            throw new BadRequestException(
              `Purchase line ${request.purchase_invoice_item_id} does not belong to invoice ${invoiceId}`,
            )
          }
        }

        const variantIds = [
          ...new Set(
            canonicalItems.map(
              (request) =>
                invoiceItemById.get(
                  request.purchase_invoice_item_id,
                )!.variant_id,
            ),
          ),
        ].sort()
        await this.lockVariants(tx, variantIds)

        const [variants, returned] = await Promise.all([
          tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, cost_price: true },
          }),
          tx.supplierReturnItem.groupBy({
            by: ['purchase_invoice_item_id'],
            where: {
              purchase_invoice_item_id: {
                in: canonicalItems.map(
                  (item) => item.purchase_invoice_item_id,
                ),
              },
            },
            _sum: { qty: true, credit_total: true },
          }),
        ])
        const variantById = new Map<
          string,
          { id: string; cost_price: Prisma.Decimal }
        >(
          variants.map((variant) => [
            variant.id,
            {
              id: variant.id,
              cost_price: variant.cost_price,
            },
          ]),
        )
        const returnedByLine = new Map<
          string,
          { qty: number; creditTotal: Prisma.Decimal }
        >(
          returned.map((row) => [
            row.purchase_invoice_item_id,
            {
              qty: row._sum.qty || 0,
              creditTotal: new Prisma.Decimal(
                row._sum.credit_total || 0,
              ),
            },
          ]),
        )

        const preparedItems = canonicalItems.map((request) => {
          const purchaseItem = invoiceItemById.get(
            request.purchase_invoice_item_id,
          )!
          const previousReturn = returnedByLine.get(
            purchaseItem.id,
          ) || {
            qty: 0,
            creditTotal: new Prisma.Decimal(0),
          }
          const variant = variantById.get(purchaseItem.variant_id)
          if (!variant) {
            throw new NotFoundException(
              `Variant not found: ${purchaseItem.variant_id}`,
            )
          }

          const originalLineCredit = new Prisma.Decimal(
            purchaseItem.net_line_total ||
              new Prisma.Decimal(purchaseItem.unit_cost)
                .mul(purchaseItem.qty)
                .toDecimalPlaces(2),
          ).toDecimalPlaces(2)
          let credit: ReturnType<
            typeof calculateSupplierReturnCredit
          >
          try {
            credit = calculateSupplierReturnCredit({
              lineQty: purchaseItem.qty,
              lineCreditTotal: originalLineCredit,
              returnedQty: previousReturn.qty,
              returnedCredit: previousReturn.creditTotal,
              requestedQty: request.qty,
              defaultUnitCredit:
                purchaseItem.net_unit_cost ||
                purchaseItem.unit_cost,
            })
          } catch (error) {
            throw new ConflictException(
              error instanceof Error
                ? `${error.message} for purchase line ${purchaseItem.id}`
                : `Invalid supplier return for purchase line ${purchaseItem.id}`,
            )
          }
          const creditTotal = credit.creditTotal
          const creditUnitCost = credit.creditUnitCost
          const inventoryUnitCost = new Prisma.Decimal(
            variant.cost_price,
          ).toDecimalPlaces(2)
          const inventoryValueRemoved = inventoryUnitCost
            .mul(request.qty)
            .toDecimalPlaces(2)

          return {
            purchaseItem,
            qty: request.qty,
            creditUnitCost,
            creditTotal,
            inventoryUnitCost,
            inventoryValueRemoved,
            variance: creditTotal
              .minus(inventoryValueRemoved)
              .toDecimalPlaces(2),
          }
        })

        const creditTotal = preparedItems
          .reduce(
            (sum, item) => sum.plus(item.creditTotal),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(2)
        const inventoryValueRemoved = preparedItems
          .reduce(
            (sum, item) =>
              sum.plus(item.inventoryValueRemoved),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(2)
        const variance = creditTotal
          .minus(inventoryValueRemoved)
          .toDecimalPlaces(2)
        const maximumAccountingValue = new Prisma.Decimal(
          '9999999999999999.99',
        )
        if (
          creditTotal.greaterThan(maximumAccountingValue) ||
          inventoryValueRemoved.greaterThan(maximumAccountingValue) ||
          variance.abs().greaterThan(maximumAccountingValue)
        ) {
          throw new BadRequestException(
            'Supplier return exceeds supported accounting value range',
          )
        }

        const returnRecord = await tx.supplierReturn.create({
          data: {
            purchase_invoice_id: invoice.id,
            supplier_id: invoice.supplier_id,
            branch_id: invoice.branch_id,
            return_number:
              `SR-${occurredAt.getTime()}-${randomUUID().slice(0, 8)}`,
            status: 'posted',
            idempotency_key: idempotencyKey,
            command_fingerprint: fingerprint,
            reason,
            credit_total: creditTotal,
            inventory_value_removed: inventoryValueRemoved,
            purchase_price_variance: variance,
            occurred_at: occurredAt,
            created_by: actor.sub,
            items: {
              create: preparedItems.map((item) => ({
                purchase_invoice_item_id:
                  item.purchaseItem.id,
                variant_id: item.purchaseItem.variant_id,
                qty: item.qty,
                credit_unit_cost: item.creditUnitCost,
                credit_total: item.creditTotal,
                inventory_unit_cost: item.inventoryUnitCost,
                inventory_value_removed:
                  item.inventoryValueRemoved,
                purchase_price_variance: item.variance,
              })),
            },
          },
          include: { items: true },
        })
        const returnItemByPurchaseLine = new Map<
          string,
          {
            id: string
            purchase_invoice_item_id: string
          }
        >(
          returnRecord.items.map((item) => [
            item.purchase_invoice_item_id,
            {
              id: item.id,
              purchase_invoice_item_id:
                item.purchase_invoice_item_id,
            },
          ]),
        )

        for (const item of preparedItems) {
          const returnItem = returnItemByPurchaseLine.get(
            item.purchaseItem.id,
          )
          if (!returnItem) {
            throw new ConflictException(
              'Created supplier return line is missing',
            )
          }

          const stockChanged = await tx.$executeRaw`
            UPDATE "InventoryStock"
            SET "qty_on_hand" = "qty_on_hand" - ${item.qty}
            WHERE "branch_id" = ${invoice.branch_id}::uuid
              AND "variant_id" = ${item.purchaseItem.variant_id}::uuid
              AND "qty_on_hand" >= ${item.qty}
              AND ("qty_on_hand" - ${item.qty}) >= "qty_reserved"
          `
          if (stockChanged !== 1) {
            throw new ConflictException(
              `Insufficient unreserved stock to return variant ${item.purchaseItem.variant_id}`,
            )
          }

          await tx.$queryRaw`
            SELECT "record_inventory_movement"(
              ${invoice.branch_id}::uuid,
              ${item.purchaseItem.variant_id}::uuid,
              'reversal'::"InventoryMovementType",
              ${-item.qty}::integer,
              0::integer,
              'SupplierReturn'::text,
              ${returnRecord.id}::text,
              ${returnItem.id}::text,
              ${`supplier-return-stock:${returnItem.id}`}::text,
              ${occurredAt}::timestamp,
              ${actor.sub}::uuid,
              ${JSON.stringify({
                purchase_invoice_id: invoice.id,
                purchase_invoice_item_id:
                  item.purchaseItem.id,
                credit_total: item.creditTotal.toFixed(2),
              })}::jsonb
            )
          `

          await tx.$queryRaw`
            SELECT "record_inventory_cost_movement"(
              ${item.purchaseItem.variant_id}::uuid,
              ${invoice.branch_id}::uuid,
              'supplier_return'::"InventoryCostMovementType",
              ${-item.qty}::integer,
              ${item.inventoryValueRemoved.negated().toFixed(2)}::numeric,
              'SupplierReturn'::text,
              ${returnRecord.id}::text,
              ${returnItem.id}::text,
              ${invoice.id}::uuid,
              ${item.purchaseItem.id}::uuid,
              ${returnRecord.id}::uuid,
              ${returnItem.id}::uuid,
              ${`supplier-return-cost:${returnItem.id}`}::text,
              ${occurredAt}::timestamp,
              ${actor.sub}::uuid,
              NULL::numeric,
              ${JSON.stringify({
                credit_total: item.creditTotal.toFixed(2),
                inventory_value_removed:
                  item.inventoryValueRemoved.toFixed(2),
                purchase_price_variance:
                  item.variance.toFixed(2),
              })}::jsonb
            )
          `
        }

        await tx.auditLog.create({
          data: {
            user_id: actor.sub,
            action: 'purchase.supplier_return.posted',
            entity: 'SupplierReturn',
            entity_id: returnRecord.id,
            meta: {
              purchase_invoice_id: invoice.id,
              reason,
              credit_total: creditTotal.toFixed(2),
              inventory_value_removed:
                inventoryValueRemoved.toFixed(2),
              purchase_price_variance: variance.toFixed(2),
              occurred_at: occurredAt.toISOString(),
            },
          },
        })

        return tx.supplierReturn.findUniqueOrThrow({
          where: { id: returnRecord.id },
          include: {
            purchase_invoice: true,
            supplier: true,
            branch: true,
            creator: {
              select: { id: true, name: true, role: true },
            },
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
            cost_movements: {
              orderBy: { sequence: 'asc' },
            },
          },
        })
      })
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const existing =
          await this.prisma.supplierReturn.findUnique({
            where: { idempotency_key: idempotencyKey },
            include: {
              purchase_invoice: true,
              supplier: true,
              branch: true,
              creator: {
                select: { id: true, name: true, role: true },
              },
              items: {
                include: {
                  variant: { include: { product: true } },
                },
              },
              cost_movements: {
                orderBy: { sequence: 'asc' },
              },
            },
          })
        if (existing) {
          if (existing.command_fingerprint === fingerprint) {
            return existing
          }
          throw new ConflictException(
            'Supplier return command belongs to different return data',
          )
        }
      }
      throw error
    }
  }

  listSupplierReturns(branchId?: string, take = 100) {
    const safeTake = Math.min(500, Math.max(1, Number(take) || 100))
    return this.prisma.supplierReturn.findMany({
      where: branchId ? { branch_id: branchId } : {},
      include: {
        purchase_invoice: true,
        supplier: true,
        branch: true,
        creator: {
          select: { id: true, name: true, role: true },
        },
        items: {
          include: {
            variant: { include: { product: true } },
          },
        },
      },
      orderBy: [
        { occurred_at: 'desc' },
        { id: 'desc' },
      ],
      take: safeTake,
    })
  }

  async reverse(
    invoiceId: string,
    dto: ReversePurchaseDto,
    actor: AuthenticatedUser,
  ) {
    const reason = dto.reason.trim()
    if (!reason) {
      throw new BadRequestException('Reversal reason is required')
    }

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          invoice_id: invoiceId,
          reason,
        }),
      )
      .digest('hex')
    const idempotencyKey = dto.command_id
      ? `purchase-reversal:${dto.command_id}`
      : `purchase-reversal:${invoiceId}`

    return this.serializable(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "PurchaseInvoice"
        WHERE "id" = ${invoiceId}::uuid
        FOR UPDATE
      `

      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        include: { items: true },
      })
      if (!invoice) {
        throw new NotFoundException('Purchase invoice not found')
      }

      if (
        actor.role !== 'owner' &&
        actor.role !== 'warehouse_manager' &&
        actor.branch_id !== invoice.branch_id
      ) {
        throw new ForbiddenException(
          'You cannot reverse a purchase for another branch',
        )
      }

      if (invoice.status === 'reversed') {
        if (
          invoice.reversal_idempotency_key === idempotencyKey &&
          invoice.reversal_command_fingerprint === fingerprint
        ) {
          return tx.purchaseInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
            include: purchaseInclude,
          })
        }
        throw new ConflictException(
          'Purchase invoice was already reversed by a different command',
        )
      }
      if (invoice.status !== 'posted') {
        throw new ConflictException(
          'Only a posted purchase invoice can be reversed',
        )
      }

      const variantIds = invoice.items
        .map((item) => item.variant_id)
        .sort()
      await this.lockVariants(tx, variantIds)

      const reversedAt = new Date()
      for (const item of invoice.items) {
        const [receiptCostMovement, receiptStockMovement] =
          await Promise.all([
            tx.inventoryCostMovement.findUnique({
              where: {
                idempotency_key: `purchase-cost:${item.id}`,
              },
            }),
            tx.inventoryMovement.findUnique({
              where: {
                idempotency_key: `purchase-receipt:${item.id}`,
              },
            }),
          ])
        if (!receiptCostMovement || !receiptStockMovement) {
          throw new ConflictException(
            'Legacy or incomplete purchase receipts cannot be reversed automatically',
          )
        }

        const [
          downstreamCostMovement,
          downstreamStockMovement,
          currentQty,
          currentVariant,
        ] = await Promise.all([
          tx.inventoryCostMovement.findFirst({
            where: {
              variant_id: item.variant_id,
              sequence: { gt: receiptCostMovement.sequence },
            },
            select: { id: true },
          }),
          tx.inventoryMovement.findFirst({
            where: {
              variant_id: item.variant_id,
              sequence: { gt: receiptStockMovement.sequence },
            },
            select: { id: true },
          }),
          tx.inventoryStock.aggregate({
            where: { variant_id: item.variant_id },
            _sum: { qty_on_hand: true },
          }),
          tx.productVariant.findUnique({
            where: { id: item.variant_id },
            select: { cost_price: true },
          }),
        ])

        if (
          downstreamCostMovement ||
          downstreamStockMovement ||
          Number(currentQty._sum.qty_on_hand || 0) !==
            receiptCostMovement.global_quantity_after ||
          !currentVariant ||
          !new Prisma.Decimal(currentVariant.cost_price).equals(
            receiptCostMovement.cost_after,
          )
        ) {
          throw new ConflictException(
            'Purchase receipt has downstream inventory activity and cannot be fully reversed',
          )
        }


        const stockChanged = await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "qty_on_hand" = "qty_on_hand" - ${item.qty}
          WHERE "branch_id" = ${invoice.branch_id}::uuid
            AND "variant_id" = ${item.variant_id}::uuid
            AND "qty_on_hand" >= ${item.qty}
            AND ("qty_on_hand" - ${item.qty}) >= "qty_reserved"
        `
        if (stockChanged !== 1) {
          throw new ConflictException(
            `Insufficient unreserved stock to reverse variant ${item.variant_id}`,
          )
        }

        await tx.$queryRaw`
          SELECT "record_inventory_movement"(
            ${invoice.branch_id}::uuid,
            ${item.variant_id}::uuid,
            'reversal'::"InventoryMovementType",
            ${-item.qty}::integer,
            0::integer,
            'PurchaseInvoice'::text,
            ${invoice.id}::text,
            ${item.id}::text,
            ${`purchase-reversal-stock:${item.id}`}::text,
            ${reversedAt}::timestamp,
            ${actor.sub}::uuid,
            ${JSON.stringify({
              reason,
              original_movement_id: receiptStockMovement.id,
            })}::jsonb
          )
        `

        await tx.$queryRaw`
          SELECT "record_inventory_cost_movement"(
            ${item.variant_id}::uuid,
            ${invoice.branch_id}::uuid,
            'purchase_reversal'::"InventoryCostMovementType",
            ${-item.qty}::integer,
            ${new Prisma.Decimal(
              receiptCostMovement.movement_value,
            ).negated().toFixed(2)}::numeric,
            'PurchaseInvoice'::text,
            ${invoice.id}::text,
            ${item.id}::text,
            ${invoice.id}::uuid,
            ${item.id}::uuid,
            NULL::uuid,
            NULL::uuid,
            ${`purchase-cost-reversal:${item.id}`}::text,
            ${reversedAt}::timestamp,
            ${actor.sub}::uuid,
            ${receiptCostMovement.cost_before.toString()}::numeric,
            ${JSON.stringify({
              reason,
              original_cost_movement_id:
                receiptCostMovement.id,
            })}::jsonb
          )
        `
      }

      await tx.$queryRaw`
        SELECT set_config(
          'bold.purchase_accounting_document_write',
          'on',
          true
        )
      `
      const reversed = await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'reversed',
          reversal_idempotency_key: idempotencyKey,
          reversal_command_fingerprint: fingerprint,
          reversal_reason: reason,
          reversed_at: reversedAt,
          reversed_by: actor.sub,
        },
      })
      await tx.$queryRaw`
        SELECT set_config(
          'bold.purchase_accounting_document_write',
          'off',
          true
        )
      `

      await tx.auditLog.create({
        data: {
          user_id: actor.sub,
          action: 'purchase.receipt.reversed',
          entity: 'PurchaseInvoice',
          entity_id: invoice.id,
          meta: {
            reason,
            idempotency_key: idempotencyKey,
            command_fingerprint: fingerprint,
            reversed_at: reversedAt.toISOString(),
          },
        },
      })

      return tx.purchaseInvoice.findUniqueOrThrow({
        where: { id: reversed.id },
        include: purchaseInclude,
      })
    })
  }

  listCostMovements(
    branchId?: string,
    variantId?: string,
    take = 100,
  ) {
    const safeTake = Math.min(500, Math.max(1, Number(take) || 100))
    return this.prisma.inventoryCostMovement.findMany({
      where: {
        ...(branchId ? { branch_id: branchId } : {}),
        ...(variantId ? { variant_id: variantId } : {}),
      },
      include: {
        variant: { include: { product: true } },
        branch: true,
        purchase_invoice: {
          include: { supplier: true },
        },
        creator: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { sequence: 'desc' },
      take: safeTake,
    })
  }

  async costReconciliation(variantId?: string) {
    return this.prisma.$queryRaw<
      Array<{
        variant_id: string
        sku: string
        product_name: string
        materialized_cost: Prisma.Decimal
        ledger_cost: Prisma.Decimal | null
        current_global_qty: bigint
        reconciled: boolean
      }>
    >`
      WITH latest AS (
        SELECT DISTINCT ON (movement."variant_id")
          movement."variant_id",
          movement."cost_after"
        FROM "InventoryCostMovement" movement
        ORDER BY
          movement."variant_id",
          movement."sequence" DESC
      ),
      stock AS (
        SELECT
          record."variant_id",
          COALESCE(SUM(record."qty_on_hand"), 0)::bigint AS "qty"
        FROM "InventoryStock" record
        GROUP BY record."variant_id"
      )
      SELECT
        variant."id" AS "variant_id",
        variant."sku",
        product."name_en" AS "product_name",
        variant."cost_price" AS "materialized_cost",
        latest."cost_after" AS "ledger_cost",
        COALESCE(stock."qty", 0)::bigint AS "current_global_qty",
        (
          (
            latest."cost_after" IS NULL
            AND COALESCE(stock."qty", 0) = 0
          )
          OR latest."cost_after" = variant."cost_price"
        ) AS "reconciled"
      FROM "ProductVariant" variant
      JOIN "Product" product
        ON product."id" = variant."product_id"
      LEFT JOIN latest
        ON latest."variant_id" = variant."id"
      LEFT JOIN stock
        ON stock."variant_id" = variant."id"
      WHERE (${variantId || null}::uuid IS NULL
        OR variant."id" = ${variantId || null}::uuid)
      ORDER BY "reconciled" ASC, variant."sku" ASC
    `
  }

  async ocrImport(fileUrl: string) {
    return {
      draft: true,
      source: fileUrl,
      items: [],
      message:
        'Upload supplier invoice – edit then confirm – supplier alias mapping supported',
    }
  }

  private async findReplay(
    db: Pick<Prisma.TransactionClient, 'purchaseInvoice'>,
    prepared: PreparedPurchaseReceipt,
    supplierId: string,
  ) {
    const existing = await db.purchaseInvoice.findFirst({
      where: {
        OR: [
          { idempotency_key: prepared.idempotencyKey },
          ...(prepared.normalizedInvoiceNumber
            ? [
                {
                  supplier_id: supplierId,
                  normalized_invoice_number:
                    prepared.normalizedInvoiceNumber,
                },
              ]
            : []),
        ],
      },
      include: purchaseInclude,
    })

    if (!existing) return null
    if (
      existing.command_fingerprint !==
      prepared.commandFingerprint
    ) {
      throw new ConflictException(
        'Purchase command or supplier invoice number belongs to different receipt data',
      )
    }
    return existing
  }

  private async lockVariants(
    tx: Prisma.TransactionClient,
    variantIds: string[],
  ) {
    if (!variantIds.length) return
    await tx.$queryRaw(
      Prisma.sql`
        SELECT variant."id"
        FROM "ProductVariant" variant
        WHERE variant."id" IN (
          ${Prisma.join(
            variantIds.map(
              (id) => Prisma.sql`${id}::uuid`,
            ),
          )}
        )
        ORDER BY variant."id"
        FOR UPDATE
      `,
    )
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 45_000,
        })
      } catch (error) {
        if (
          attempt < 3 &&
          this.prismaErrorCode(error) === 'P2034'
        ) {
          continue
        }
        throw error
      }
    }
    throw new ConflictException(
      'Purchase transaction could not be serialized',
    )
  }

  private isUniqueConflict(error: unknown) {
    return this.prismaErrorCode(error) === 'P2002'
  }

  private prismaErrorCode(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error
    ) {
      return String((error as { code?: unknown }).code || '')
    }
    return ''
  }
}
