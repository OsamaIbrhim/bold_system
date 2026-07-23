type MoneyInput = number | string

function cents(value: MoneyInput): number {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(String(value).trim())
  if (!match) throw new TypeError('Invalid money value')
  const sign = match[1] === '-' ? -1 : 1
  const fraction = match[3] || ''
  const result = sign * (
    Number(match[2]) * 100 +
    Number((fraction + '00').slice(0, 2)) +
    (Number(fraction[2] || '0') >= 5 ? 1 : 0)
  )
  if (!Number.isSafeInteger(result)) throw new RangeError('Money value is too large')
  return result
}

function formatCents(valueCents: number): string {
  const sign = valueCents < 0 ? '-' : ''
  const absolute = Math.abs(valueCents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

export function formatMoney(value: MoneyInput): string {
  return formatCents(cents(value))
}

export function lineTotal(
  unitPrice: MoneyInput,
  unitTax: MoneyInput,
  quantity: number,
): string {
  if (!Number.isSafeInteger(quantity)) throw new TypeError('Invalid quantity')
  const total = (cents(unitPrice) + cents(unitTax)) * quantity
  if (!Number.isSafeInteger(total)) throw new RangeError('Money line is too large')
  return formatCents(total)
}
