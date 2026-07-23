export type HeldSaleScope = {
  branch_id: string
  cashier_id: string
  shift_id: string
}

export type HeldSaleItem = {
  variant_id: string
  qty: number
}

export type HeldSaleCustomer = {
  id?: string
  name?: string | null
  phone: string
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EGYPTIAN_PHONE =
  /^(?:\+20|0)1[0125]\d{8}$/

export class HeldSaleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeldSaleValidationError'
  }
}

function requiredId(value: unknown, label: string) {
  const normalized = String(value || '')
  if (!UUID.test(normalized)) {
    throw new HeldSaleValidationError(
      `${label} is invalid`,
    )
  }
  return normalized
}

export function validateHeldSaleItems(
  value: unknown,
): HeldSaleItem[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 100
  ) {
    throw new HeldSaleValidationError(
      'Held sale must contain one to 100 items',
    )
  }

  const seen = new Set<string>()
  return value.map((item: any) => {
    const variantId = requiredId(
      item?.variant_id,
      'Held sale variant',
    )
    const qty = Number(item?.qty)
    if (
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 1_000
    ) {
      throw new HeldSaleValidationError(
        'Held sale quantity is invalid',
      )
    }
    if (seen.has(variantId)) {
      throw new HeldSaleValidationError(
        'Held sale contains a duplicate variant',
      )
    }
    seen.add(variantId)
    return { variant_id: variantId, qty }
  })
}

export function sanitizeHeldSaleCustomer(
  value: unknown,
): HeldSaleCustomer | null {
  if (value === null || value === undefined) return null
  const customer = value as any
  const phone = String(customer.phone || '')
    .trim()
    .replace(/[\s-]+/g, '')
  if (!EGYPTIAN_PHONE.test(phone)) {
    throw new HeldSaleValidationError(
      'Held sale customer phone is invalid',
    )
  }
  const name = String(customer.name || '').trim()
  if (name.length > 120) {
    throw new HeldSaleValidationError(
      'Held sale customer name is too long',
    )
  }
  const id = customer.id
    ? requiredId(customer.id, 'Held sale customer')
    : undefined
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    phone,
  }
}

export function parseHeldSaleItems(
  serialized: unknown,
) {
  if (typeof serialized !== 'string') {
    throw new HeldSaleValidationError(
      'Held sale item storage is invalid',
    )
  }
  try {
    return validateHeldSaleItems(
      JSON.parse(serialized),
    )
  } catch (error) {
    if (error instanceof HeldSaleValidationError) {
      throw error
    }
    throw new HeldSaleValidationError(
      'Held sale item storage is invalid',
    )
  }
}

export function heldSaleBelongsToScope(
  row: Partial<HeldSaleScope>,
  scope: HeldSaleScope,
) {
  return (
    row.branch_id === scope.branch_id &&
    row.cashier_id === scope.cashier_id &&
    row.shift_id === scope.shift_id
  )
}
