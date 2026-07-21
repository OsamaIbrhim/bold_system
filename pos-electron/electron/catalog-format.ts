export const SIGNED_CATALOG_FORMAT_VERSION = 'signed-price-v1'

export type SignedCatalogProduct = {
  id?: unknown
  selling_price?: unknown
  unit_tax?: unknown
  price_version?: unknown
  price_token?: unknown
  price_issued_at?: unknown
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidSignedCatalogProduct(
  product: SignedCatalogProduct,
) {
  const price = Number(product.selling_price)
  const tax = Number(product.unit_tax)

  return (
    nonEmptyString(product.id) &&
    Number.isFinite(price) &&
    price >= 0 &&
    Number.isFinite(tax) &&
    tax >= 0 &&
    nonEmptyString(product.price_version) &&
    nonEmptyString(product.price_token) &&
    nonEmptyString(product.price_issued_at)
  )
}

export function requiresFullCatalogRefresh(
  storedFormatVersion: string,
  unsignedProductCount: number,
) {
  return (
    storedFormatVersion !== SIGNED_CATALOG_FORMAT_VERSION ||
    Math.max(0, Number(unsignedProductCount) || 0) > 0
  )
}
