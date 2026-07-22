import { describe, expect, it } from 'vitest'
import {
  isValidOfflineAccountingContext,
  maxTerminalSequence,
  nextTerminalSequence,
  offlineAccountingContextMatches,
  parseTerminalSequence,
} from '../electron/offline-accounting'

const now = Date.parse('2026-07-22T10:00:00.000Z')
const context = {
  v: 1 as const,
  purpose: 'pos-offline-accounting' as const,
  key_id: 'offline-2026',
  token: 'offline-2026.payload.signature',
  session_id: 'session-1',
  user_id: 'user-1',
  role: 'cashier' as const,
  branch_id: 'branch-1',
  terminal_id: 'terminal-1',
  shift_id: 'shift-1',
  issued_at: '2026-07-22T09:00:00.000Z',
  expires_at: '2026-07-22T11:00:00.000Z',
  server_last_sale_sequence: '8',
}

const expected = {
  session: {
    user: {
      id: 'user-1',
      name: 'Cashier',
      role: 'cashier' as const,
      branch_id: 'branch-1',
    },
  },
  device: {
    branch_id: 'branch-1',
    terminal_id: 'terminal-1',
  },
  shift: {
    id: 'shift-1',
    branch_id: 'branch-1',
  },
}

describe('offline accounting context', () => {
  it('accepts only a live, key-id-bound context matching the user, terminal and shift', () => {
    expect(isValidOfflineAccountingContext(context, now)).toBe(true)
    expect(offlineAccountingContextMatches(context, expected, now)).toBe(true)
    expect(
      offlineAccountingContextMatches(
        context,
        { ...expected, shift: { id: 'shift-2', branch_id: 'branch-1' } },
        now,
      ),
    ).toBe(false)
  })

  it('rejects an expired context and a token whose key id was replaced', () => {
    expect(
      isValidOfflineAccountingContext(context, Date.parse(context.expires_at)),
    ).toBe(false)
    expect(
      isValidOfflineAccountingContext(
        { ...context, token: 'different.payload.signature' },
        now,
      ),
    ).toBe(false)
  })

  it('uses exact decimal bigint sequencing without JavaScript number precision loss', () => {
    expect(parseTerminalSequence('9007199254740993')).toBe(9007199254740993n)
    expect(maxTerminalSequence('8', '10', '9')).toBe('10')
    expect(nextTerminalSequence('9007199254740993')).toBe('9007199254740994')
    expect(() => parseTerminalSequence('-1')).toThrow()
    expect(() => parseTerminalSequence('1.5')).toThrow()
  })
})
