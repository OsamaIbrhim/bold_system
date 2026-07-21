import { describe, expect, it } from 'vitest'
import {
  SIGNED_CATALOG_FORMAT_VERSION,
  isValidSignedCatalogProduct,
  requiresFullCatalogRefresh,
} from '../electron/catalog-format'

describe('signed local catalog migration', () => {
  it('forces a full snapshot for a database created before signed prices', () => {
    expect(requiresFullCatalogRefresh('', 10)).toBe(true)
    expect(requiresFullCatalogRefresh('legacy-v1', 0)).toBe(true)
  })

  it('self-heals when any product row loses its signature fields', () => {
    expect(
      requiresFullCatalogRefresh(
        SIGNED_CATALOG_FORMAT_VERSION,
        1,
      ),
    ).toBe(true)
  })

  it('keeps incremental sync only after a complete signed catalog is stored', () => {
    expect(
      requiresFullCatalogRefresh(
        SIGNED_CATALOG_FORMAT_VERSION,
        0,
      ),
    ).toBe(false)
  })

  it('accepts a complete signed product snapshot', () => {
    expect(
      isValidSignedCatalogProduct({
        id: 'variant-1',
        selling_price: 150,
        unit_tax: 21,
        price_version: 'version-1',
        price_token: 'signed-token',
        price_issued_at: '2026-07-21T00:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('rejects a replacement snapshot before the current catalog is deleted', () => {
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
