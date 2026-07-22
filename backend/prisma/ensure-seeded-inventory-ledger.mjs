import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/**
 * Backfills only stock rows that have never had a ledger movement, then fails
 * closed if any materialized stock balance differs from the append-only ledger.
 *
 * This is intended for deterministic development/performance seed workflows,
 * not as a production repair command.
 */
export async function ensureSeededInventoryLedger(
  prisma,
  source = 'development-seed',
) {
  const inserted = await prisma.$executeRawUnsafe(`
    INSERT INTO "InventoryMovement" (
      "branch_id",
      "variant_id",
      "movement_type",
      "on_hand_delta",
      "reserved_delta",
      "on_hand_after",
      "reserved_after",
      "reference_type",
      "reference_id",
      "idempotency_key",
      "occurred_at",
      "metadata"
    )
    SELECT
      stock."branch_id",
      stock."variant_id",
      'opening_balance'::"InventoryMovementType",
      stock."qty_on_hand",
      stock."qty_reserved",
      stock."qty_on_hand",
      stock."qty_reserved",
      'InventorySeed',
      stock."branch_id"::text || ':' || stock."variant_id"::text,
      'seed-opening:' || stock."branch_id"::text || ':' || stock."variant_id"::text,
      COALESCE(stock."last_sold_at", CURRENT_TIMESTAMP)::timestamp(3),
      jsonb_build_object(
        'source', '${source.replaceAll("'", "''")}',
        'reason', 'seeded materialized inventory opening balance'
      )
    FROM "InventoryStock" stock
    WHERE (stock."qty_on_hand" <> 0 OR stock."qty_reserved" <> 0)
      AND NOT EXISTS (
        SELECT 1
        FROM "InventoryMovement" movement
        WHERE movement."branch_id" = stock."branch_id"
          AND movement."variant_id" = stock."variant_id"
      )
    ON CONFLICT ("idempotency_key") DO NOTHING
  `)

  const rows = await prisma.$queryRawUnsafe(`
    WITH ledger AS (
      SELECT
        movement."branch_id",
        movement."variant_id",
        COALESCE(SUM(movement."on_hand_delta"), 0)::bigint AS "on_hand",
        COALESCE(SUM(movement."reserved_delta"), 0)::bigint AS "reserved"
      FROM "InventoryMovement" movement
      GROUP BY movement."branch_id", movement."variant_id"
    )
    SELECT COUNT(*)::integer AS "mismatch_count"
    FROM "InventoryStock" stock
    FULL OUTER JOIN ledger
      ON ledger."branch_id" = stock."branch_id"
     AND ledger."variant_id" = stock."variant_id"
    WHERE COALESCE(stock."qty_on_hand", 0)::bigint
          <> COALESCE(ledger."on_hand", 0)
       OR COALESCE(stock."qty_reserved", 0)::bigint
          <> COALESCE(ledger."reserved", 0)
  `)

  const mismatchCount = Number(rows[0]?.mismatch_count || 0)
  if (mismatchCount !== 0) {
    throw new Error(
      `Seed inventory ledger reconciliation failed for ${mismatchCount} stock row(s)`,
    )
  }

  process.stdout.write(
    `${JSON.stringify({
      suite: 'seed-inventory-ledger',
      source,
      inserted_opening_movements: Number(inserted),
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
    await ensureSeededInventoryLedger(prisma)
  } finally {
    await prisma.$disconnect()
  }
}
