import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export async function ensureSeededTransferState(
  prisma,
  source = 'development-seed',
) {
  const normalized = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('bold.transfer_maintenance', 'on', true)
    `

    return tx.$executeRaw`
      UPDATE "Transfer" transfer
      SET
        "status" = 'pending'::"TransferStatus",
        "shipped_by" = NULL,
        "shipped_at" = NULL,
        "received_by" = NULL,
        "received_at" = NULL,
        "cancelled_by" = NULL,
        "cancelled_at" = NULL,
        "cancellation_reason" = NULL,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE transfer."status" IN (
          'shipped'::"TransferStatus",
          'partially_received'::"TransferStatus",
          'received'::"TransferStatus"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "TransferItem" item
          WHERE item."transfer_id" = transfer."id"
            AND (
              item."shipped_qty" <> 0
              OR item."received_qty" <> 0
              OR item."damaged_qty" <> 0
              OR item."missing_qty" <> 0
            )
        )
    `
  })

  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS "mismatch_count"
    FROM "Transfer" transfer
    WHERE
      (
        transfer."status" IN (
          'pending'::"TransferStatus",
          'cancelled'::"TransferStatus"
        )
        AND EXISTS (
          SELECT 1
          FROM "TransferItem" item
          WHERE item."transfer_id" = transfer."id"
            AND (
              item."shipped_qty" <> 0
              OR item."received_qty" <> 0
              OR item."damaged_qty" <> 0
              OR item."missing_qty" <> 0
            )
        )
      )
      OR
      (
        transfer."status" = 'received'::"TransferStatus"
        AND EXISTS (
          SELECT 1
          FROM "TransferItem" item
          WHERE item."transfer_id" = transfer."id"
            AND (
              item."shipped_qty" = 0
              OR item."shipped_qty" <>
                item."received_qty" +
                item."damaged_qty" +
                item."missing_qty"
            )
        )
      )
      OR
      (
        transfer."status" IN (
          'shipped'::"TransferStatus",
          'partially_received'::"TransferStatus"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "TransferItem" item
          WHERE item."transfer_id" = transfer."id"
            AND item."shipped_qty" >
              item."received_qty" +
              item."damaged_qty" +
              item."missing_qty"
        )
      )
  `

  const mismatchCount = Number(rows[0]?.mismatch_count || 0)
  if (mismatchCount !== 0) {
    throw new Error(
      `Seed transfer state reconciliation failed for ${mismatchCount} transfer(s)`,
    )
  }

  process.stdout.write(
    `${JSON.stringify({
      suite: 'seed-transfer-state',
      source,
      normalized_legacy_fixtures: Number(normalized),
      reconciliation: true,
    })}\n`,
  )
}

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMain) {
  const prisma = new PrismaClient()
  try {
    await ensureSeededTransferState(prisma)
  } finally {
    await prisma.$disconnect()
  }
}
