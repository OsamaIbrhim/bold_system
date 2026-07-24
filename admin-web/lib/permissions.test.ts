import { describe, expect, it } from 'vitest'
import {
  canAccessPath,
  firstAccessiblePath,
  hasCapability,
  requiredCapability,
} from './permissions'

const readOnlyUser = {
  capabilities: ['products.read', 'customers.read'],
}

describe('admin authorization', () => {
  it('protects both a page and its nested routes with the page capability', () => {
    expect(requiredCapability('/products')).toBe('products.read')
    expect(requiredCapability('/sales/invoice-id')).toBe('sales.read')
    expect(canAccessPath(readOnlyUser, '/products')).toBe(true)
    expect(canAccessPath(readOnlyUser, '/sales/invoice-id')).toBe(false)
  })

  it('does not grant write actions from a read capability', () => {
    expect(hasCapability(readOnlyUser, 'products.read')).toBe(true)
    expect(hasCapability(readOnlyUser, 'products.manage')).toBe(false)
    expect(hasCapability(readOnlyUser, 'customers.manage')).toBe(false)
  })

  it('selects the first page the user can actually access', () => {
    expect(firstAccessiblePath(readOnlyUser)).toBe('/products')
    expect(firstAccessiblePath({ capabilities: [] })).toBe('/login')
  })
})
