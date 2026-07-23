import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export async function ensureSeededCostLedger(
  prisma,
  source = 'development-seed',
) {
  const inserted = await prisma.$executeRawUnsafe(`
    INSERT INTO "InventoryCostMovement" (
      "variant_id",
      "movement_type",
      "quantity_delta",
      "global_quantity_before",
      "global_quantity_after",
      "unit_cost",
      "cost_before",
      "cost_after",
      "inventory_value_before",
      "movement_value",
      "inventory_value_after",
      "rounding_adjustment",
      "reference_type",
      "reference_id",
      "idempotency_key",
      "occurred_at",
      "metadata"
    )
    SELECT
      variant."id",
      'opening_balance'::"InventoryCostMovementType",
      totals."qty_on_hand"::integer,
      0,
      totals."qty_on_hand"::integer,
      variant."cost_price"::numeric(18, 6),
      0,
      variant."cost_price",
      0,
      ROUND(totals."qty_on_hand" * variant."cost_price", 2),
      ROUND(totals."qty_on_hand" * variant."cost_price", 2),
      0,
      'InventorySeed',
      variant."id"::text,
      'cost-seed-opening:' || variant."id"::text,
      CURRENT_TIMESTAMP,
      jsonb_build_object(
        'source', '${source.replaceAll("'", "''")}',
        'reason', 'seeded global moving-average opening value'
      )
    FROM "ProductVariant" variant
    JOIN (
      SELECT
        stock."variant_id",
        SUM(stock."qty_on_hand")::bigint AS "qty_on_hand"
      FROM "InventoryStock" stock
      GROUP BY stock."variant_id"
    ) totals
      ON totals."variant_id" = variant."id"
    WHERE totals."qty_on_hand" > 0
      AND totals."qty_on_hand" <= 2147483647
      AND NOT EXISTS (
        SELECT 1
        FROM "InventoryCostMovement" movement
        WHERE movement."variant_id" = variant."id"
      )
    ON CONFLICT ("idempotency_key") DO NOTHING
  `)

  const rows = await prisma.$queryRawUnsafe(`
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
        SUM(record."qty_on_hand")::bigint AS "qty"
      FROM "InventoryStock" record
      GROUP BY record."variant_id"
    )
    SELECT COUNT(*)::integer AS "mismatch_count"
    FROM "ProductVariant" variant
    JOIN stock ON stock."variant_id" = variant."id"
    LEFT JOIN latest ON latest."variant_id" = variant."id"
    WHERE stock."qty" > 0
      AND (
        latest."variant_id" IS NULL
        OR latest."cost_after" <> variant."cost_price"
      )
  `)

  const mismatchCount = Number(rows[0]?.mismatch_count || 0)
  if (mismatchCount !== 0) {
    throw new Error(
      `Seed cost ledger reconciliation failed for ${mismatchCount} variant(s)`,
    )
  }

  process.stdout.write(
    `${JSON.stringify({
      suite: 'seed-inventory-cost-ledger',
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
    await ensureSeededCostLedger(prisma)
  } finally {
    await prisma.$disconnect()
  }
}
