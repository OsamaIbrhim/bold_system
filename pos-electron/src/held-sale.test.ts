import { describe, expect, it } from 'vitest'
import {
  heldSaleBelongsToScope,
  parseHeldSaleItems,
  sanitizeHeldSaleCustomer,
  validateHeldSaleItems,
} from '../electron/held-sale'

const variantOne =
  '11111111-1111-4111-8111-111111111111'
const variantTwo =
  '22222222-2222-4222-8222-222222222222'

describe('held sale validation', () => {
  it('keeps only immutable variant identities and quantities', () => {
    expect(
      validateHeldSaleItems([
        {
          variant_id: variantOne,
          qty: 2,
          unit_price: 0.01,
          price_token: 'renderer-controlled',
        },
      ]),
    ).toEqual([
      {
        variant_id: variantOne,
        qty: 2,
      },
    ])
  })

  it('rejects duplicate variants and invalid quantities', () => {
    expect(() =>
      validateHeldSaleItems([
        { variant_id: variantOne, qty: 1 },
        { variant_id: variantOne, qty: 2 },
      ]),
    ).toThrow(/duplicate/i)
    expect(() =>
      validateHeldSaleItems([
        { variant_id: variantTwo, qty: -1 },
      ]),
    ).toThrow(/quantity/i)
  })

  it('rejects corrupt persisted item JSON', () => {
    expect(() => parseHeldSaleItems('{')).toThrow(
      /storage/i,
    )
  })

  it('normalizes a minimal customer record', () => {
    expect(
      sanitizeHeldSaleCustomer({
        id: '33333333-3333-4333-8333-333333333333',
        name: '  Osama  ',
        phone: '010-1234 5678',
        total_spent: 99_999,
      }),
    ).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Osama',
      phone: '01012345678',
    })
  })

  it('isolates drafts by branch, cashier, and shift', () => {
    const scope = {
      branch_id: 'branch-a',
      cashier_id: 'cashier-a',
      shift_id: 'shift-a',
    }
    expect(
      heldSaleBelongsToScope(scope, scope),
    ).toBe(true)
    expect(
      heldSaleBelongsToScope(
        { ...scope, cashier_id: 'cashier-b' },
        scope,
      ),
    ).toBe(false)
    expect(
      heldSaleBelongsToScope(
        { ...scope, shift_id: 'shift-b' },
        scope,
      ),
    ).toBe(false)
  })
})
