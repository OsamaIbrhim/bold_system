import { CartItem, SaleDraft } from './types'

export const toCents = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100)

export const fromCents = (value: number) => value / 100

export const money = (value: number | string | null | undefined) =>
  Number(value || 0).toFixed(2)

export function cartTotals(items: CartItem[]) {
  const subtotalCents = items.reduce(
    (sum, item) => sum + toCents(item.unit_price) * item.qty,
    0,
  )
  const taxCents = items.reduce(
    (sum, item) => sum + toCents(item.unit_tax) * item.qty,
    0,
  )
  return {
    subtotal: fromCents(subtotalCents),
    tax: fromCents(taxCents),
    total: fromCents(subtotalCents + taxCents),
    quantity: items.reduce((sum, item) => sum + item.qty, 0),
  }
}

export function normalizeEgyptianPhone(value: string) {
  return value.trim().replace(/[\s-]+/g, '')
}

export function isValidEgyptianPhone(value: string) {
  return /^(?:\+20|0)1[0125]\d{8}$/.test(normalizeEgyptianPhone(value))
}

const HELD_SALES_KEY = 'bold_pos_held_sales_v1'

export function readHeldSales(): SaleDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(HELD_SALES_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function writeHeldSales(value: SaleDraft[]) {
  localStorage.setItem(HELD_SALES_KEY, JSON.stringify(value.slice(0, 50)))
}

export function saveHeldSale(
  draft: Omit<SaleDraft, 'id' | 'created_at' | 'updated_at'>,
) {
  const now = new Date().toISOString()
  const value: SaleDraft = {
    ...draft,
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
  }
  writeHeldSales([value, ...readHeldSales()])
  return value
}

export function removeHeldSale(id: string) {
  writeHeldSales(readHeldSales().filter((sale) => sale.id !== id))
}

export function paymentLabel(method: string) {
  return (
    {
      cash: 'نقدي',
      card: 'بطاقة',
      instapay: 'InstaPay',
      vodafone_cash: 'فودافون كاش',
      installment: 'تقسيط',
    } as Record<string, string>
  )[method] || method
}