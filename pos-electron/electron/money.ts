export type MoneyInput = number | string

const MONEY_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?$/

export function toCents(value: MoneyInput): number {
  const normalized = String(value).trim()
  const match = MONEY_PATTERN.exec(normalized)
  if (!match) throw new TypeError('Money value must be a plain decimal')

  const sign = match[1] === '-' ? -1 : 1
  const whole = Number(match[2])
  const fraction = match[3] || ''
  const cents = Number((fraction + '00').slice(0, 2))
  const roundsUp = Number(fraction[2] || '0') >= 5
  const result = sign * (whole * 100 + cents + (roundsUp ? 1 : 0))
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Money value exceeds the safe cents range')
  }
  return result
}

export function fromCents(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('Cents value must be a safe integer')
  }
  return value / 100
}

export function formatMoney(value: MoneyInput): string {
  const cents = toCents(value)
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

export function lineCents(
  unitValue: MoneyInput,
  quantity: number,
): number {
  if (!Number.isSafeInteger(quantity)) {
    throw new TypeError('Money quantity must be a safe integer')
  }
  const result = toCents(unitValue) * quantity
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Money line exceeds the safe cents range')
  }
  return result
}

export function sameMoney(left: MoneyInput, right: MoneyInput): boolean {
  return toCents(left) === toCents(right)
}
