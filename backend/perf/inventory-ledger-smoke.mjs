import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import {
  enableTransferCommandContext,
  markTransferFixtureShipped,
  resolveTransferFixtureReceipt,
} from './support/transfer-command-context.mjs'

const prisma = new PrismaClient()

function boundedIntegerEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

const transactionTimeoutMs = boundedIntegerEnv(
  'INVENTORY_LEDGER_SMOKE_TIMEOUT_MS',
  120_000,
  30_000,
  300_000,
)
const transactionMaxWaitMs = boundedIntegerEnv(
  'INVENTORY_LEDGER_SMOKE_MAX_WAIT_MS',
  15_000,
  1_000,
  60_000,
)

class RollbackInventoryLedgerSmoke extends Error {}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function assertReconciled(tx, branchId, variantId) {
  const [stock, totals] = await Promise.all([
    tx.inventoryStock.findUnique({
      where: {
        branch_id_variant_id: {
          branch_id: branchId,
          variant_id: variantId,
        },
      },
    }),
    tx.inventoryMovement.aggregate({
      where: { branch_id: branchId, variant_id: variantId },
      _sum: { on_hand_delta: true, reserved_delta: true },
    }),
  ])
  invariant(stock, `Missing stock row for ${branchId}/${variantId}`)
  invariant(
    stock.qty_on_hand === Number(totals._sum.on_hand_delta || 0),
    `On-hand reconciliation failed for ${branchId}/${variantId}`,
  )
  invariant(
    stock.qty_reserved === Number(totals._sum.reserved_delta || 0),
    `Reserved reconciliation failed for ${branchId}/${variantId}`,
  )
}

async function findSingleTransferMovement(
  tx,
  { movementType, transferId, transferItemId },
) {
  const movements = await tx.inventoryMovement.findMany({
    where: {
      movement_type: movementType,
      reference_type: 'Transfer',
      reference_id: transferId,
      reference_line_id: transferItemId,
    },
    take: 2,
  })
  invariant(
    movements.length === 1,
    `Expected one ${movementType} movement for transfer item ${transferItemId}, found ${movements.length}`,
  )
  return movements[0]
}

let summary
try {
  await prisma.$transaction(
    async (tx) => {
      await enableTransferCommandContext(tx)

      let sourceStock = await tx.inventoryStock.findFirst({
        where: {
          branch: { is_active: true },
          qty_on_hand: { gte: 5 },
        },
        orderBy: { qty_on_hand: 'desc' },
      })

      let sourceBranch
      let variant
      if (sourceStock) {
        ;[sourceBranch, variant] = await Promise.all([
          tx.branch.findUnique({ where: { id: sourceStock.branch_id } }),
          tx.productVariant.findUnique({ where: { id: sourceStock.variant_id } }),
        ])
      } else {
        sourceBranch =
          (await tx.branch.findFirst({ where: { is_active: true } })) ||
          (await tx.branch.create({
            data: {
              code: `LEDGER-${randomUUID().slice(0, 8)}`,
              name_ar: 'اختبار دفتر المخزون',
              name_en: 'Inventory ledger smoke',
            },
          }))
        const product = await tx.product.create({
          data: {
            name_en: `Ledger smoke product ${randomUUID().slice(0, 8)}`,
            name_ar: 'منتج اختبار دفتر المخزون',
            has_variants: false,
          },
        })
        variant = await tx.productVariant.create({
          data: {
            product_id: product.id,
            sku: `LEDGER-${randomUUID()}`,
            barcode_internal: `LEDGER-${randomUUID()}`,
            cost_price: 10,
          },
        })
        sourceStock = await tx.inventoryStock.create({
          data: {
            branch_id: sourceBranch.id,
            variant_id: variant.id,
            qty_on_hand: 20,
          },
        })
      }

      invariant(sourceBranch && variant && sourceStock, 'Unable to prepare source inventory')

      const destinationBranch =
        (await tx.branch.findFirst({
          where: { id: { not: sourceBranch.id }, is_active: true },
        })) ||
        (await tx.branch.create({
          data: {
            code: `LEDGER-DEST-${randomUUID().slice(0, 8)}`,
            name_ar: 'فرع اختبار دفتر المخزون',
            name_en: 'Inventory ledger destination',
          },
        }))

      const actor =
        (await tx.user.findFirst()) ||
        (await tx.user.create({
          data: {
            branch_id: sourceBranch.id,
            name: 'Inventory ledger smoke actor',
            password_hash: 'smoke-test-only-not-a-login-credential',
            role: 'owner',
          },
        }))
      const supplier =
        (await tx.supplier.findFirst()) ||
        (await tx.supplier.create({
          data: {
            name: 'Inventory ledger smoke supplier',
            alias_names: [],
          },
        }))

      await tx.inventoryStock.upsert({
        where: {
          branch_id_variant_id: {
            branch_id: destinationBranch.id,
            variant_id: variant.id,
          },
        },
        update: {},
        create: {
          branch_id: destinationBranch.id,
          variant_id: variant.id,
          qty_on_hand: 0,
        },
      })

      const occurredAt = new Date()
      const saleSyncId = randomUUID()
      const saleChanged = await tx.$executeRaw`
        UPDATE "InventoryStock"
        SET "qty_on_hand" = "qty_on_hand" - 1,
            "last_sold_at" = ${occurredAt}
        WHERE "branch_id" = ${sourceBranch.id}::uuid
          AND "variant_id" = ${variant.id}::uuid
          AND ("qty_on_hand" - "qty_reserved") >= 1
      `
      invariant(saleChanged === 1, 'Unable to reserve one unit for ledger sale smoke')

      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED')
      const sale = await tx.salesInvoice.create({
        data: {
          invoice_number: `LEDGER-SALE-${randomUUID()}`,
          branch_id: sourceBranch.id,
          cashier_id: actor.id,
          status: 'completed',
          subtotal: 10,
          tax_amount: 0,
          total: 10,
          payment_method: 'cash',
          language: 'ar',
          sync_id: saleSyncId,
          occurred_at: occurredAt,
          received_at: occurredAt,
          items: {
            create: [
              {
                variant_id: variant.id,
                qty: 1,
                unit_price: 10,
                unit_cost: 10,
                unit_tax: 0,
              },
            ],
          },
        },
        include: { items: true },
      })
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
      const saleMovement = await tx.inventoryMovement.findUnique({
        where: { idempotency_key: `sale:${sale.items[0].id}` },
      })
      invariant(saleMovement?.on_hand_delta === -1, 'Sale movement was not recorded')

      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED')
      const returnRecord = await tx.return.create({
        data: {
          original_invoice_id: sale.id,
          branch_id: sourceBranch.id,
          return_invoice_number: `LEDGER-RETURN-${randomUUID()}`,
          reason: 'Inventory ledger smoke',
          is_partial: false,
          created_by: actor.id,
          refund_subtotal: 10,
          refund_tax: 0,
          refund_total: 10,
          status: 'completed',
          items: {
            create: [
              {
                sales_invoice_item_id: sale.items[0].id,
                variant_id: variant.id,
                qty: 1,
                unit_price: 10,
                unit_cost: 10,
                unit_tax: 0,
              },
            ],
          },
        },
        include: { items: true },
      })
      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: sourceBranch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { increment: 1 } },
      })
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
      const returnMovement = await tx.inventoryMovement.findUnique({
        where: { idempotency_key: `return:${returnRecord.items[0].id}` },
      })
      invariant(returnMovement?.on_hand_delta === 1, 'Return movement was not recorded')

      const purchase = await tx.purchaseInvoice.create({
        data: {
          supplier_id: supplier.id,
          branch_id: sourceBranch.id,
          invoice_number: `LEDGER-PURCHASE-${randomUUID()}`,
          subtotal: 20,
          discount_amount: 0,
          discount_percent: 0,
          total: 20,
          created_by: actor.id,
          items: {
            create: [{ variant_id: variant.id, qty: 2, unit_cost: 10 }],
          },
        },
        include: { items: true },
      })
      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: sourceBranch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { increment: 2 } },
      })
      await tx.$queryRaw`
        SELECT "record_inventory_movement"(
          ${sourceBranch.id}::uuid,
          ${variant.id}::uuid,
          'purchase_receipt'::"InventoryMovementType",
          2::integer,
          0::integer,
          'PurchaseInvoice'::text,
          ${purchase.id}::text,
          ${purchase.items[0].id}::text,
          ${`purchase-receipt:${purchase.items[0].id}`}::text,
          ${purchase.created_at}::timestamp,
          ${actor.id}::uuid,
          ${JSON.stringify({ smoke: true })}::jsonb
        )
      `
      const purchaseMovement = await tx.inventoryMovement.findUnique({
        where: {
          idempotency_key: `purchase-receipt:${purchase.items[0].id}`,
        },
      })
      invariant(
        purchaseMovement?.on_hand_delta === 2,
        'Purchase receipt movement was not recorded',
      )

      const transfer = await tx.transfer.create({
        data: {
          from_branch_id: sourceBranch.id,
          to_branch_id: destinationBranch.id,
          transfer_number: `LEDGER-TRANSFER-${randomUUID()}`,
          status: 'pending',
          created_by: actor.id,
          items: { create: [{ variant_id: variant.id, qty: 1 }] },
        },
        include: { items: true },
      })

      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED')
      const transferOutChanged = await tx.$executeRaw`
        UPDATE "InventoryStock"
        SET "qty_on_hand" = "qty_on_hand" - 1
        WHERE "branch_id" = ${sourceBranch.id}::uuid
          AND "variant_id" = ${variant.id}::uuid
          AND ("qty_on_hand" - "qty_reserved") >= 1
      `
      invariant(transferOutChanged === 1, 'Unable to apply transfer-out stock change')
      await markTransferFixtureShipped(tx, {
        transferId: transfer.id,
        actorId: actor.id,
        items: [{ id: transfer.items[0].id, quantity: 1 }],
      })
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
      const transferOutMovement = await findSingleTransferMovement(tx, {
        movementType: 'transfer_out',
        transferId: transfer.id,
        transferItemId: transfer.items[0].id,
      })
      invariant(
        transferOutMovement.on_hand_delta === -1,
        'Transfer-out movement was not recorded',
      )

      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED')
      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: destinationBranch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { increment: 1 } },
      })
      await resolveTransferFixtureReceipt(tx, {
        transferId: transfer.id,
        actorId: actor.id,
        items: [{ id: transfer.items[0].id, received: 1 }],
      })
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
      const transferInMovement = await findSingleTransferMovement(tx, {
        movementType: 'transfer_in',
        transferId: transfer.id,
        transferItemId: transfer.items[0].id,
      })
      invariant(
        transferInMovement.on_hand_delta === 1,
        'Transfer-in movement was not recorded',
      )

      await assertReconciled(tx, sourceBranch.id, variant.id)
      await assertReconciled(tx, destinationBranch.id, variant.id)

      summary = {
        suite: 'inventory-movement-ledger',
        sale: true,
        return: true,
        purchase_receipt: true,
        transfer_out: true,
        transfer_in: true,
        reconciliation: true,
        rolled_back: true,
      }
      throw new RollbackInventoryLedgerSmoke('rollback successful smoke transaction')
    },
    {
      isolationLevel: 'Serializable',
      maxWait: transactionMaxWaitMs,
      timeout: transactionTimeoutMs,
    },
  )
} catch (error) {
  if (!(error instanceof RollbackInventoryLedgerSmoke)) throw error
} finally {
  await prisma.$disconnect()
}

process.stdout.write(`${JSON.stringify(summary)}\n`)
