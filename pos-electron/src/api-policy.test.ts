import { describe, expect, it } from 'vitest'
import {
  PosApiPolicyError,
  assertAllowedApiRequest,
} from '../electron/api-policy'

describe('Electron main API policy', () => {
  it('allows only the exact method and POS route combinations', () => {
    expect(
      assertAllowedApiRequest(
        '/products/search?q=shirt',
        'GET',
      ),
    ).toEqual({
      pathname: '/products/search?q=shirt',
      method: 'GET',
    })
    expect(
      assertAllowedApiRequest('/pos/sale', 'POST'),
    ).toEqual({
      pathname: '/pos/sale',
      method: 'POST',
    })
  })

  it('blocks external URLs and method escalation', () => {
    expect(() =>
      assertAllowedApiRequest(
        'https://attacker.example/collect',
        'POST',
      ),
    ).toThrow(PosApiPolicyError)
    expect(() =>
      assertAllowedApiRequest('/sales/123', 'DELETE'),
    ).toThrow(PosApiPolicyError)
    expect(() =>
      assertAllowedApiRequest(
        '/shifts/123/offline-context',
        'POST',
      ),
    ).toThrow(PosApiPolicyError)
  })
})
