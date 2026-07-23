export function enableTransferCommandContext(tx) {
  assertTransactionClient(tx)

  return tx.$queryRaw`
    SELECT set_config('bold.transfer_command', 'on', true)
  `
}

function assertTransactionClient(tx) {
  if (
    !tx ||
    typeof tx.$queryRaw !== 'function' ||
    typeof tx.$executeRaw !== 'function'
  ) {
    throw new TypeError(
      'Transfer fixture helper requires a Prisma transaction client',
    )
  }
}

function assertUuidLike(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
}

export async function markTransferFixtureShipped(
  tx,
  { transferId, actorId, items },
) {
  assertTransactionClient(tx)
  assertUuidLike(transferId, 'transferId')
  assertUuidLike(actorId, 'actorId')
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('items must contain at least one transfer item')
  }

  for (const item of items) {
    assertUuidLike(item.id, 'item.id')
    assertPositiveInteger(item.quantity, 'item.quantity')
    const changed = await tx.$executeRaw`
      UPDATE "TransferItem"
      SET "shipped_qty" = "qty"
      WHERE "id" = ${item.id}::uuid
        AND "transfer_id" = ${transferId}::uuid
        AND "qty" = ${item.quantity}
        AND "shipped_qty" = 0
    `
    if (changed !== 1) {
      throw new Error(`Unable to ship transfer item ${item.id}`)
    }
  }

  const changed = await tx.$executeRaw`
    UPDATE "Transfer"
    SET "status" = 'shipped'::"TransferStatus",
        "shipped_by" = ${actorId}::uuid,
        "shipped_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${transferId}::uuid
      AND "status" = 'pending'::"TransferStatus"
  `
  if (changed !== 1) {
    throw new Error(`Unable to mark transfer ${transferId} as shipped`)
  }
}

export async function resolveTransferFixtureReceipt(
  tx,
  { transferId, actorId, items },
) {
  assertTransactionClient(tx)
  assertUuidLike(transferId, 'transferId')
  assertUuidLike(actorId, 'actorId')
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('items must contain at least one transfer item')
  }

  for (const item of items) {
    assertUuidLike(item.id, 'item.id')
    const received = item.received ?? 0
    const damaged = item.damaged ?? 0
    const missing = item.missing ?? 0
    for (const [name, value] of Object.entries({ received, damaged, missing })) {
      if (!Number.isInteger(value) || value < 0) {
        throw new TypeError(`item.${name} must be a non-negative integer`)
      }
    }
    if (received + damaged + missing <= 0) {
      throw new TypeError('Each receipt item must resolve at least one unit')
    }

    const changed = await tx.$executeRaw`
      UPDATE "TransferItem"
      SET "received_qty" = "received_qty" + ${received},
          "damaged_qty" = "damaged_qty" + ${damaged},
          "missing_qty" = "missing_qty" + ${missing}
      WHERE "id" = ${item.id}::uuid
        AND "transfer_id" = ${transferId}::uuid
        AND (
          "received_qty" + "damaged_qty" + "missing_qty" +
          ${received + damaged + missing}
        ) <= "shipped_qty"
    `
    if (changed !== 1) {
      throw new Error(`Unable to resolve transfer item ${item.id}`)
    }
  }

  const [remaining] = await tx.$queryRaw`
    SELECT COALESCE(SUM(
      "shipped_qty" - "received_qty" - "damaged_qty" - "missing_qty"
    ), 0)::bigint AS quantity
    FROM "TransferItem"
    WHERE "transfer_id" = ${transferId}::uuid
  `
  const status = remaining.quantity === 0n ? 'received' : 'partially_received'
  const changed = await tx.$executeRaw`
    UPDATE "Transfer"
    SET "status" = ${status}::"TransferStatus",
        "received_by" = ${actorId}::uuid,
        "received_at" = CASE
          WHEN ${status} = 'received' THEN CURRENT_TIMESTAMP
          ELSE "received_at"
        END,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${transferId}::uuid
      AND "status" IN (
        'shipped'::"TransferStatus",
        'partially_received'::"TransferStatus"
      )
  `
  if (changed !== 1) {
    throw new Error(`Unable to record receipt for transfer ${transferId}`)
  }
  return status
}
