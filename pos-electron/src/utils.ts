import { CartItem } from './types'
import {
  formatMoney,
  fromCents,
  lineCents,
  toCents,
} from '../electron/money'

export { fromCents, lineCents, toCents }

export const money = (value: number | string | null | undefined) =>
  formatMoney(value ?? 0)

export function cartTotals(items: CartItem[]) {
  const subtotalCents = items.reduce(
    (sum, item) => sum + lineCents(item.unit_price, item.qty),
    0,
  )
  const taxCents = items.reduce(
    (sum, item) => sum + lineCents(item.unit_tax, item.qty),
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
