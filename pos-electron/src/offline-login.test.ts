import { describe, expect, it } from 'vitest'
import {
  createOfflineLoginVerifier,
  verifyOfflineLogin,
} from '../electron/offline-login'

describe('offline cashier login verifier', () => {
  it('verifies the same normalized cashier credentials', () => {
    const verifier = createOfflineLoginVerifier(
      '+201000000000',
      'Bold1234',
    )
    expect(verifier).not.toHaveProperty('password')
    expect(
      verifyOfflineLogin(
        verifier,
        ' +201000000000 ',
        'Bold1234',
      ),
    ).toBe(true)
  })

  it('rejects a different phone or password', () => {
    const verifier = createOfflineLoginVerifier(
      '+201000000000',
      'Bold1234',
    )
    expect(
      verifyOfflineLogin(
        verifier,
        '+201000000001',
        'Bold1234',
      ),
    ).toBe(false)
    expect(
      verifyOfflineLogin(
        verifier,
        '+201000000000',
        'Wrong1234',
      ),
    ).toBe(false)
  })
})
