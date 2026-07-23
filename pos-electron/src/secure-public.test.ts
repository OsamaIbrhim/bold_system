import { describe, expect, it } from 'vitest'
import {
  sanitizeBootstrapState,
  sanitizeSecureState,
} from '../electron/secure-public'

describe('renderer secure-state projection', () => {
  it('removes every bearer credential before crossing IPC', () => {
    const projected = sanitizeSecureState({
      auth: {
        session: {
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          user: {
            id: 'user-1',
            name: 'Cashier',
            role: 'cashier',
            branch_id: 'branch-1',
          },
        },
        offline_valid_until:
          '2026-07-24T10:00:00.000Z',
      },
      device: {
        device_id: 'device-1',
        device_token: 'device-secret',
        branch_id: 'branch-1',
        terminal_id: 'terminal-1',
        terminal_code: 'POS-1',
      },
      accounting: {
        v: 1,
        purpose: 'pos-offline-accounting',
        key_id: 'accounting-key',
        token: 'accounting-key.payload.signature',
        session_id: 'session-1',
        user_id: 'user-1',
        role: 'cashier',
        branch_id: 'branch-1',
        terminal_id: 'terminal-1',
        shift_id: 'shift-1',
        issued_at: '2026-07-23T08:00:00.000Z',
        expires_at: '2099-07-23T18:00:00.000Z',
        server_last_sale_sequence: '5',
      },
    })

    expect(projected.auth?.session).toEqual({
      user: {
        id: 'user-1',
        name: 'Cashier',
        role: 'cashier',
        branch_id: 'branch-1',
      },
    })
    expect(projected.device).not.toHaveProperty(
      'device_token',
    )
    expect(projected.accounting).not.toHaveProperty(
      'token',
    )
    expect(
      JSON.stringify(projected),
    ).not.toMatch(/access-secret|refresh-secret|device-secret|payload\.signature/)
  })

  it('forces cashier login on every application bootstrap', () => {
    const projected = sanitizeBootstrapState({
      auth: {
        session: {
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          user: {
            id: 'user-1',
            role: 'cashier',
            branch_id: 'branch-1',
          },
        },
        offline_valid_until:
          '2099-07-24T10:00:00.000Z',
      },
      device: {
        device_id: 'device-1',
        device_token: 'device-secret',
        branch_id: 'branch-1',
        terminal_id: 'terminal-1',
        terminal_code: 'POS-1',
      },
    })

    expect(projected.device).toMatchObject({
      terminal_code: 'POS-1',
    })
    expect(projected.auth).toBeNull()
    expect(projected.accounting).toBeNull()
  })
})
