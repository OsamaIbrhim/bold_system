import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  lineCents,
  sameMoney,
  toCents,
} from './money'

describe('POS money arithmetic', () => {
  it('rounds decimal strings without binary multiplication', () => {
    expect(toCents('1.005')).toBe(101)
    expect(toCents('-1.005')).toBe(-101)
  })

  it('contains pre-existing binary noise at the cents boundary', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(sameMoney(0.1 + 0.2, '0.30')).toBe(true)
  })

  it('keeps line totals in integer cents', () => {
    expect(lineCents('10.33', 3)).toBe(3099)
    expect(formatMoney('10.999')).toBe('11.00')
  })
})
