import { describe, expect, it } from 'vitest'
import {
  PosSaleValidationError,
  validateLocalSaleInput,
} from '../electron/sale-validation'

const branch =
  '11111111-1111-4111-8111-111111111111'
const variant =
  '22222222-2222-4222-8222-222222222222'
const syncId =
  '33333333-3333-4333-8333-333333333333'
const sellerId =
  '55555555-5555-4555-8555-555555555555'

function sale(overrides: Record<string, unknown> = {}) {
  return {
    sync_id: syncId,
    branch_id: branch,
    seller_id: sellerId,
    payment_method: 'cash',
    local_total: 114,
    items: [
      {
        variant_id: variant,
        qty: 1,
        unit_price: 100,
        unit_tax: 14,
        price_version: 'price-v1',
        price_token: 'price-key.payload.signature',
      },
    ],
    ...overrides,
  }
}

describe('local sale IPC validation', () => {
  it('normalizes a complete signed sale command', () => {
    expect(
      validateLocalSaleInput(sale(), branch),
    ).toMatchObject({
      syncId,
      branchId: branch,
      sellerId,
      paymentMethod: 'cash',
      localTotal: 114,
    })
  })

  it('requires a seller attribution', () => {
    expect(() =>
      validateLocalSaleInput(sale({ seller_id: '' }), branch),
    ).toThrow('اختر البائع')
  })

  it('rejects negative quantities and duplicate variants', () => {
    expect(() =>
      validateLocalSaleInput(
        sale({
          items: [
            {
              ...sale().items[0],
              qty: -1,
            },
          ],
        }),
        branch,
      ),
    ).toThrow(PosSaleValidationError)

    expect(() =>
      validateLocalSaleInput(
        sale({
          items: [
            sale().items[0],
            sale().items[0],
          ],
        }),
        branch,
      ),
    ).toThrow('تكرار')
  })

  it('rejects another branch and unsigned price data', () => {
    expect(() =>
      validateLocalSaleInput(
        sale({
          branch_id:
            '44444444-4444-4444-8444-444444444444',
        }),
        branch,
      ),
    ).toThrow('غير مسجل')
    expect(() =>
      validateLocalSaleInput(
        sale({
          items: [
            {
              ...sale().items[0],
              price_token: '',
            },
          ],
        }),
        branch,
      ),
    ).toThrow('لقطة سعر')
  })
})
