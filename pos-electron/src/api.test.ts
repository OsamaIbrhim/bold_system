import { describe, expect, it } from 'vitest'
import {
  terminalCredentialDisposition,
  validAuth,
  validOfflineAccountingContext,
  validDevice,
} from './api'

describe('POS secure startup state', () => {
  it('rejects the stale undefined branch value that previously bypassed login', () => {
    expect(
      validDevice({
        device_id: 'device-1',
        branch_id: 'undefined',
        terminal_id: 'terminal',
        terminal_code: 'POS-1',
      }),
    ).toBe(false)

    expect(
      validAuth({
        session: {
          user: { id: 'u', branch_id: 'undefined' },
        },
        offline_valid_until: '2026-07-23T12:00:00.000Z',
      }),
    ).toBe(false)
  })


  it('rejects expired or malformed offline accounting authorization', () => {
    const context = {
      v: 1,
      purpose: 'pos-offline-accounting',
      key_id: 'offline-2026',
      authorized: true,
      session_id: 'session-1',
      user_id: 'user-1',
      role: 'cashier',
      branch_id: 'branch-1',
      terminal_id: 'terminal-1',
      shift_id: 'shift-1',
      issued_at: '2026-07-22T09:00:00.000Z',
      expires_at: '2026-07-22T11:00:00.000Z',
      server_last_sale_sequence: '7',
    }

    expect(
      validOfflineAccountingContext(
        context,
        Date.parse('2026-07-22T10:00:00.000Z'),
      ),
    ).toBe(true)
    expect(
      validOfflineAccountingContext(
        context,
        Date.parse('2026-07-22T11:00:00.000Z'),
      ),
    ).toBe(false)
    expect(
      validOfflineAccountingContext(
        { ...context, server_last_sale_sequence: '1.5' },
        Date.parse('2026-07-22T10:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('accepts a complete enrolled device and cashier session', () => {
    expect(
      validDevice({
        device_id: 'device-1',
        branch_id: 'branch-1',
        terminal_id: 'terminal-1',
        terminal_code: 'POS-1',
      }),
    ).toBe(true)

    expect(
      validAuth({
        session: {
          user: { id: 'user-1', branch_id: 'branch-1' },
        },
        offline_valid_until: '2026-07-20T00:00:00.000Z',
      }),
    ).toBe(true)
  })
})

describe('POS terminal credential protection', () => {
  it('never clears enrollment because of a generic network error', () => {
    expect(
      terminalCredentialDisposition('NETWORK_ERROR', '/terminals/heartbeat'),
    ).toBe('ignore')
  })

  it('requires repeated heartbeat confirmation for invalid credentials', () => {
    expect(
      terminalCredentialDisposition(
        'TERMINAL_CREDENTIAL_INVALID',
        '/terminals/heartbeat',
      ),
    ).toBe('confirm')

    expect(
      terminalCredentialDisposition(
        'TERMINAL_CREDENTIAL_INVALID',
        '/pos/sale',
      ),
    ).toBe('ignore')
  })

  it('treats an explicit server revocation as definitive', () => {
    expect(
      terminalCredentialDisposition('TERMINAL_REVOKED', '/terminals/heartbeat'),
    ).toBe('clear')
  })
})
