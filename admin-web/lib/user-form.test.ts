import { describe, expect, it } from 'vitest'
import { normalizeUserPhone, validateUserPhone } from './user-form'

describe('user phone validation', () => {
  it('rejects an empty phone for an interactive user', () => {
    expect(validateUserPhone('')).toContain('مطلوب')
  })

  it('rejects a malformed phone', () => {
    expect(validateUserPhone('12345')).toContain('صحيح')
  })

  it('accepts and normalizes a valid phone containing spaces', () => {
    expect(validateUserPhone('010 1234 5678')).toBe('')
    expect(normalizeUserPhone('010 1234 5678')).toBe('01012345678')
  })
})
