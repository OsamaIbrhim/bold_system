import { describe, expect, it } from 'vitest'
import {
  cartTotals,
  isValidEgyptianPhone,
  normalizeEgyptianPhone,
} from './utils'

const item = (qty: number, unit_price: number, unit_tax: number) => ({
  id: 'variant-1',
  variant_id: 'variant-1',
  sku: 'SKU-1',
  name: 'Item',
  qty,
  unit_price,
  unit_tax,
  available_qty: 20,
})

describe('POS checkout calculations', () => {
  it('uses integer cents for subtotal, tax and total', () => {
    expect(cartTotals([item(3, 19.99, 2.8)])).toEqual({
      subtotal: 59.97,
      tax: 8.4,
      total: 68.37,
      quantity: 3,
    })
  })

  it('aggregates multiple cart lines', () => {
    expect(
      cartTotals([
        item(2, 100, 14),
        {
          ...item(1, 49.5, 6.93),
          id: 'variant-2',
          variant_id: 'variant-2',
        },
      ]),
    ).toEqual({
      subtotal: 249.5,
      tax: 34.93,
      total: 284.43,
      quantity: 3,
    })
  })
})

describe('Egyptian customer phone normalization', () => {
  it('removes spaces and dashes', () =>
    expect(normalizeEgyptianPhone('010-1234 5678')).toBe('01012345678'))

  it('accepts local and international formats', () => {
    expect(isValidEgyptianPhone('01012345678')).toBe(true)
    expect(isValidEgyptianPhone('+201012345678')).toBe(true)
    expect(isValidEgyptianPhone('011123')).toBe(false)
  })
})