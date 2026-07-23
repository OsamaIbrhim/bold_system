// Bump this value whenever the server-side price-token contract changes in a
// way that requires every terminal to replace its cached catalog atomically.
export const SIGNED_CATALOG_FORMAT_VERSION = 'signed-price-kid-v2'

export type SignedCatalogProduct = {
  id?: unknown
  selling_price?: unknown
  unit_tax?: unknown
  price_version?: unknown
  price_token?: unknown
  price_issued_at?: unknown
}

export type CatalogStock = {
  variant_id?: unknown
  qty_on_hand?: unknown
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

export function signedPriceTokenKeyId(value: unknown) {
  if (!nonEmptyString(value)) return null
  const parts = String(value).split('.')
  if (parts.length !== 3) return null
  const keyId = parts[0]
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(keyId)
    ? keyId
    : null
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
    !!signedPriceTokenKeyId(product.price_token) &&
    nonEmptyString(product.price_issued_at) &&
    Number.isFinite(new Date(String(product.price_issued_at)).getTime())
  )
}

export function isValidCatalogStock(
  stock: CatalogStock,
) {
  const quantity = Number(stock.qty_on_hand)
  return (
    nonEmptyString(stock.variant_id) &&
    Number.isInteger(quantity) &&
    quantity >= 0
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
