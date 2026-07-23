import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { ReceivePurchaseDto } from './dto/receive-purchase.dto'

export type PreparedPurchaseLine = {
  variant_id: string
  qty: number
  unit_cost: Prisma.Decimal
  line_subtotal: Prisma.Decimal
  allocated_discount: Prisma.Decimal
  net_line_total: Prisma.Decimal
  net_unit_cost: Prisma.Decimal
}

export type PreparedPurchaseReceipt = {
  normalizedInvoiceNumber: string | null
  subtotal: Prisma.Decimal
  discount: Prisma.Decimal
  total: Prisma.Decimal
  lines: PreparedPurchaseLine[]
  commandFingerprint: string
  idempotencyKey: string
}

function decimal(value: Prisma.Decimal | number | string) {
  return new Prisma.Decimal(value)
}

function cents(value: Prisma.Decimal) {
  return BigInt(value.toDecimalPlaces(2).mul(100).toFixed(0))
}

function fromCents(value: bigint) {
  return decimal(value.toString()).div(100).toDecimalPlaces(2)
}

export function normalizeSupplierInvoiceNumber(value?: string) {
  const normalized = value
    ?.normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()

  if (normalized && normalized.length > 100) {
    throw new Error(
      'Normalized supplier invoice number cannot exceed 100 characters',
    )
  }

  return normalized || null
}


export function calculateSupplierReturnCredit(input: {
  lineQty: number
  lineCreditTotal: Prisma.Decimal | number | string
  returnedQty: number
  returnedCredit: Prisma.Decimal | number | string
  requestedQty: number
  defaultUnitCredit: Prisma.Decimal | number | string
}) {
  if (
    !Number.isSafeInteger(input.lineQty) ||
    !Number.isSafeInteger(input.returnedQty) ||
    !Number.isSafeInteger(input.requestedQty) ||
    input.lineQty < 1 ||
    input.returnedQty < 0 ||
    input.requestedQty < 1
  ) {
    throw new Error('Supplier return quantities must be positive integers')
  }

  const remainingQty = input.lineQty - input.returnedQty
  if (remainingQty < 0 || input.requestedQty > remainingQty) {
    throw new Error(
      `Only ${Math.max(0, remainingQty)} unit(s) remain returnable`,
    )
  }

  const remainingCredit = decimal(input.lineCreditTotal)
    .minus(decimal(input.returnedCredit))
    .toDecimalPlaces(2)
  if (remainingCredit.isNegative()) {
    throw new Error('Returned supplier credit exceeds the purchase line')
  }

  const creditTotal =
    input.requestedQty === remainingQty
      ? remainingCredit
      : Prisma.Decimal.min(
          remainingCredit,
          decimal(input.defaultUnitCredit)
            .mul(input.requestedQty)
            .toDecimalPlaces(2),
        )

  return {
    remainingQty,
    creditTotal,
    creditUnitCost: creditTotal
      .div(input.requestedQty)
      .toDecimalPlaces(6),
  }
}

export function preparePurchaseReceipt(
  dto: ReceivePurchaseDto,
): PreparedPurchaseReceipt {
  const aggregated = new Map<
    string,
    { qty: number; gross: Prisma.Decimal }
  >()

  for (const item of dto.items) {
    const current = aggregated.get(item.variant_id) || {
      qty: 0,
      gross: decimal(0),
    }
    const nextQty = current.qty + item.qty
    if (
      !Number.isSafeInteger(nextQty) ||
      nextQty > 2_147_483_647
    ) {
      throw new Error(
        `Purchase quantity exceeds supported range for variant ${item.variant_id}`,
      )
    }
    aggregated.set(item.variant_id, {
      qty: nextQty,
      gross: current.gross.plus(decimal(item.unit_cost).mul(item.qty)),
    })
  }

  const rawLines = [...aggregated.entries()]
    .map(([variant_id, value]) => ({
      variant_id,
      qty: value.qty,
      gross: value.gross.toDecimalPlaces(2),
    }))
    .sort((left, right) => left.variant_id.localeCompare(right.variant_id))

  const subtotal = rawLines
    .reduce((sum, line) => sum.plus(line.gross), decimal(0))
    .toDecimalPlaces(2)

  if (subtotal.isNegative()) {
    throw new Error('Purchase subtotal cannot be negative')
  }
  if (subtotal.greaterThan(decimal('9999999999999999.99'))) {
    throw new Error('Purchase subtotal exceeds supported monetary range')
  }

  const discount =
    dto.discount_amount !== undefined
      ? decimal(dto.discount_amount).toDecimalPlaces(2)
      : subtotal
          .mul(dto.discount_percent || 0)
          .div(100)
          .toDecimalPlaces(2)

  if (discount.isNegative() || discount.greaterThan(subtotal)) {
    throw new Error('Discount cannot exceed purchase subtotal')
  }

  const subtotalCents = cents(subtotal)
  const discountCents = cents(discount)
  const allocations = rawLines.map((line) => {
    const grossCents = cents(line.gross)
    if (subtotalCents === 0n) {
      return {
        ...line,
        grossCents,
        allocatedCents: 0n,
        remainder: 0n,
      }
    }

    const numerator = discountCents * grossCents
    return {
      ...line,
      grossCents,
      allocatedCents: numerator / subtotalCents,
      remainder: numerator % subtotalCents,
    }
  })

  let undistributed =
    discountCents -
    allocations.reduce((sum, line) => sum + line.allocatedCents, 0n)

  const byRemainder = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.variant_id.localeCompare(right.variant_id)
    }
    return left.remainder > right.remainder ? -1 : 1
  })

  for (const line of byRemainder) {
    if (undistributed <= 0n) break
    line.allocatedCents += 1n
    undistributed -= 1n
  }

  const allocationByVariant = new Map(
    byRemainder.map((line) => [line.variant_id, line.allocatedCents]),
  )

  const lines = allocations.map((line) => {
    const allocatedDiscount = fromCents(
      allocationByVariant.get(line.variant_id) || 0n,
    )
    const netLineTotal = line.gross
      .minus(allocatedDiscount)
      .toDecimalPlaces(2)

    return {
      variant_id: line.variant_id,
      qty: line.qty,
      unit_cost: line.gross.div(line.qty).toDecimalPlaces(6),
      line_subtotal: line.gross,
      allocated_discount: allocatedDiscount,
      net_line_total: netLineTotal,
      net_unit_cost: netLineTotal.div(line.qty).toDecimalPlaces(6),
    }
  })

  const allocatedTotal = lines
    .reduce((sum, line) => sum.plus(line.allocated_discount), decimal(0))
    .toDecimalPlaces(2)
  if (!allocatedTotal.equals(discount)) {
    throw new Error('Purchase discount allocation is not exact')
  }

  const normalizedInvoiceNumber = normalizeSupplierInvoiceNumber(
    dto.invoice_number,
  )
  if (!dto.command_id && !normalizedInvoiceNumber) {
    throw new Error(
      'command_id is required when supplier invoice number is unavailable',
    )
  }

  const canonical = {
    version: 2,
    supplier_id: dto.supplier_id,
    branch_id: dto.branch_id,
    invoice_number: normalizedInvoiceNumber,
    invoice_date: dto.invoice_date
      ? new Date(dto.invoice_date).toISOString().slice(0, 10)
      : null,
    received_at: dto.received_at
      ? new Date(dto.received_at).toISOString()
      : null,
    discount_amount: discount.toFixed(2),
    discount_percent:
      dto.discount_percent === undefined
        ? null
        : decimal(dto.discount_percent).toFixed(2),
    ocr_source_file: dto.ocr_source_file || null,
    items: lines.map((line) => ({
      variant_id: line.variant_id,
      qty: line.qty,
      line_subtotal: line.line_subtotal.toFixed(2),
      allocated_discount: line.allocated_discount.toFixed(2),
      net_line_total: line.net_line_total.toFixed(2),
    })),
  }
  const commandFingerprint = createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
  const idempotencyKey = dto.command_id
    ? `purchase-command:${dto.command_id}`
    : normalizedInvoiceNumber
      ? `purchase-invoice:${dto.supplier_id}:${normalizedInvoiceNumber}`
      : `purchase-fingerprint:${commandFingerprint}`

  return {
    normalizedInvoiceNumber,
    subtotal,
    discount,
    total: subtotal.minus(discount).toDecimalPlaces(2),
    lines,
    commandFingerprint,
    idempotencyKey,
  }
}
