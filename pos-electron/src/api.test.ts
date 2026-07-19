import { describe, expect, it } from 'vitest'
import { validAuth, validDevice } from './api'

describe('POS secure startup state', () => {
  it('rejects the stale undefined branch value that previously bypassed login', () => {
    expect(validDevice({ device_id:'device-1', device_token:'token', branch_id:'undefined', terminal_id:'terminal', terminal_code:'POS-1' })).toBe(false)
    expect(validAuth({ session:{ access_token:'a', refresh_token:'r', user:{ id:'u', branch_id:'undefined' } } })).toBe(false)
  })

  it('accepts a complete enrolled device and cashier session', () => {
    expect(validDevice({ device_id:'device-1', device_token:'token', branch_id:'branch-1', terminal_id:'terminal-1', terminal_code:'POS-1' })).toBe(true)
    expect(validAuth({
      session:{ access_token:'access', refresh_token:'refresh', user:{ id:'user-1', branch_id:'branch-1' } },
      offline_valid_until:'2026-07-20T00:00:00.000Z',
    })).toBe(true)
  })
})
