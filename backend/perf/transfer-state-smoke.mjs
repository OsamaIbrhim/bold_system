import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const rollback = Symbol('rollback')

try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('bold.transfer_command', 'on', true)`

      const actor = await tx.user.findFirst({
        where: { role: { in: ['owner', 'warehouse_manager'] }, is_active: true },
      })
      const branches = await tx.branch.findMany({
        where: { is_active: true },
        take: 2,
        orderBy: { id: 'asc' },
      })
      const stock = await tx.inventoryStock.findFirst({
        where: { qty_on_hand: { gte: 3 } },
        orderBy: [{ variant_id: 'asc' }, { branch_id: 'asc' }],
      })
      if (!actor || branches.length < 2 || !stock) {
        throw new Error('Smoke requires an active inventory actor, two branches, and stock >= 3')
      }

      const source =
        branches.find((branch) => branch.id === stock.branch_id) ||
        await tx.branch.findUniqueOrThrow({ where: { id: stock.branch_id } })
      const destination =
        branches.find((branch) => branch.id !== source.id) ||
        await tx.branch.findFirstOrThrow({
          where: { is_active: true, id: { not: source.id } },
        })

      await tx.inventoryStock.upsert({
        where: {
          branch_id_variant_id: {
            branch_id: destination.id,
            variant_id: stock.variant_id,
          },
        },
        update: {},
        create: {
          branch_id: destination.id,
          variant_id: stock.variant_id,
          qty_on_hand: 0,
        },
      })

      const transferId = randomUUID()
      const itemId = randomUUID()
      await tx.$executeRaw`
        INSERT INTO "Transfer" (
          "id", "from_branch_id", "to_branch_id", "status",
          "transfer_number", "created_by", "idempotency_key",
          "command_fingerprint", "created_at", "updated_at"
        ) VALUES (
          ${transferId}::uuid, ${source.id}::uuid, ${destination.id}::uuid,
          'pending'::"TransferStatus", ${`SMOKE-${randomUUID()}`},
          ${actor.id}::uuid, ${randomUUID()}, ${'0'.repeat(64)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `
      await tx.$executeRaw`
        INSERT INTO "TransferItem" (
          "id", "transfer_id", "variant_id", "qty",
          "shipped_qty", "received_qty", "damaged_qty", "missing_qty"
        ) VALUES (
          ${itemId}::uuid, ${transferId}::uuid, ${stock.variant_id}::uuid,
          3, 0, 0, 0, 0
        )
      `

      await tx.$executeRaw`
        UPDATE "InventoryStock"
        SET "qty_on_hand" = "qty_on_hand" - 3
        WHERE "branch_id" = ${source.id}::uuid
          AND "variant_id" = ${stock.variant_id}::uuid
      `
      await tx.$executeRaw`
        UPDATE "Transfer"
        SET "status" = 'shipped'::"TransferStatus",
            "shipped_by" = ${actor.id}::uuid,
            "shipped_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${transferId}::uuid
      `
      await tx.$executeRaw`
        UPDATE "TransferItem"
        SET "shipped_qty" = 3
        WHERE "id" = ${itemId}::uuid
      `

      await tx.$executeRaw`
        UPDATE "InventoryStock"
        SET "qty_on_hand" = "qty_on_hand" + 2
        WHERE "branch_id" = ${destination.id}::uuid
          AND "variant_id" = ${stock.variant_id}::uuid
      `
      await tx.$executeRaw`
        UPDATE "Transfer"
        SET "status" = 'received'::"TransferStatus",
            "received_by" = ${actor.id}::uuid,
            "received_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${transferId}::uuid
      `
      await tx.$executeRaw`
        UPDATE "TransferItem"
        SET "received_qty" = 2, "missing_qty" = 1
        WHERE "id" = ${itemId}::uuid
      `
      await tx.$executeRawUnsafe(
        'SET CONSTRAINTS "TransferItem_inventory_and_transit_movements" IMMEDIATE',
      )

      const [result] = await tx.$queryRaw`
        SELECT
          item."shipped_qty",
          item."received_qty",
          item."missing_qty",
          COALESCE(SUM(transit."quantity_delta"), 0)::bigint AS transit_balance
        FROM "TransferItem" item
        LEFT JOIN "TransferTransitMovement" transit
          ON transit."transfer_item_id" = item."id"
        WHERE item."id" = ${itemId}::uuid
        GROUP BY item."id"
      `
      if (
        result.shipped_qty !== 3 ||
        result.received_qty !== 2 ||
        result.missing_qty !== 1 ||
        result.transit_balance !== 0n
      ) {
        throw new Error(`Transfer reconciliation failed: ${JSON.stringify(result)}`)
      }

      process.stdout.write(
        `${JSON.stringify({
          suite: 'transfer-state-machine',
          ship: true,
          partial_receipt: true,
          missing_resolution: true,
          in_transit_reconciliation: true,
          rolled_back: true,
        })}\n`,
      )
      throw rollback
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 15_000,
      timeout: 120_000,
    },
  )
} catch (error) {
  if (error !== rollback) throw error
} finally {
  await prisma.$disconnect()
}
