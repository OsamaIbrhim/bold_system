import { describe, expect, it } from 'vitest'
import {
  SIGNED_CATALOG_FORMAT_VERSION,
  isValidSignedCatalogProduct,
  requiresFullCatalogRefresh,
  signedPriceTokenKeyId,
} from '../electron/catalog-format'

const v2Token = 'price-2026-07.eyJ2IjoyfQ.signature'

describe('versioned signed local catalog migration', () => {
  it('forces a full snapshot for unsigned and pre-key-id catalogs', () => {
    expect(requiresFullCatalogRefresh('', 10)).toBe(true)
    expect(requiresFullCatalogRefresh('signed-price-v1', 0)).toBe(true)
  })

  it('self-heals when any product row loses its signature fields', () => {
    expect(
      requiresFullCatalogRefresh(
        SIGNED_CATALOG_FORMAT_VERSION,
        1,
      ),
    ).toBe(true)
  })

  it('keeps incremental sync only after a complete v2 catalog is stored', () => {
    expect(
      requiresFullCatalogRefresh(
        SIGNED_CATALOG_FORMAT_VERSION,
        0,
      ),
    ).toBe(false)
  })

  it('extracts a valid key id only from the three-part token contract', () => {
    expect(signedPriceTokenKeyId(v2Token)).toBe('price-2026-07')
    expect(signedPriceTokenKeyId('legacy-payload.signature')).toBeNull()
    expect(signedPriceTokenKeyId('bad.key.id.extra')).toBeNull()
  })

  it('accepts a complete key-id signed product snapshot', () => {
    expect(
      isValidSignedCatalogProduct({
        id: 'variant-1',
        selling_price: 150,
        unit_tax: 21,
        price_version: 'version-1',
        price_token: v2Token,
        price_issued_at: '2026-07-21T00:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('rejects legacy, malformed, or incomplete replacement snapshots', () => {
    expect(
      isValidSignedCatalogProduct({
        id: 'variant-1',
        selling_price: 150,
        unit_tax: 21,
        price_version: 'version-1',
        price_token: 'legacy-payload.signature',
        price_issued_at: '2026-07-21T00:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      isValidSignedCatalogProduct({
        id: 'variant-1',
        selling_price: 150,
        unit_tax: 21,
        price_version: '',
        price_token: '',
        price_issued_at: '',
      }),
    ).toBe(false)
  })
})
