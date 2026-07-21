import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { isRetryableSyncError, performSync } from './sync'

describe('Phase 5A synchronization', () => {
  it('classifies transient and permanent API errors', () => {
    expect(isRetryableSyncError(new ApiError({ code: 'NETWORK_ERROR' }))).toBe(true)
    expect(isRetryableSyncError(new ApiError({}, 503))).toBe(true)
    expect(isRetryableSyncError(new ApiError({}, 429))).toBe(true)
    expect(
      isRetryableSyncError(
        new ApiError({ code: 'TERMINAL_CREDENTIAL_INVALID' }, 401),
      ),
    ).toBe(true)
    expect(isRetryableSyncError(new ApiError({}, 409))).toBe(false)
    expect(isRetryableSyncError(new ApiError({}, 422))).toBe(false)
    expect(isRetryableSyncError(new SyntaxError('bad payload'))).toBe(false)
  })

  it('persists the official invoice mapping after a successful sale', async () => {
    const calls: any[] = []
    const status = {
      device_id: 'device',
      terminal_name: 'POS',
      app_version: '1',
      sync_status: 'never',
      last_sync_at: null,
      last_error: null,
      pending_count: 1,
      sync_cursor: null,
    }
    let reads = 0
    const local: any = {
      sync_get_status: async () => ({
        ...status,
        pending_count: reads > 1 ? 0 : status.pending_count,
      }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => {
        reads += 1
        return reads === 1
          ? [{ id: 'sync-1', payload: JSON.stringify({
              sync_id: 'sync-1',
              items: [{ variant_id: 'v1', qty: 1 }],
            }) }]
          : []
      },
      sync_mark_sending: async (id: string) => {
        calls.push(['sending', id])
        return { ok: true }
      },
      sync_mark_sent: async (value: any) => {
        calls.push(['sent', value])
        return { ok: true }
      },
      sync_mark_failed: async () => ({ ok: true }),
      sync_apply_pull: async () => ({ ok: true }),
    }
    const client: any = {
      heartbeat: async () => ({}),
      sale: async () => ({
        id: 'server-id',
        invoice_number: 'B-BOLD-01-100',
      }),
      pull: async () => ({
        products: [],
        stock: [],
        cursor: 'cursor-1',
        has_more: false,
        server_time: '2026-07-21T00:00:00.000Z',
      }),
    }

    const result = await performSync('branch-1', local, client)

    expect(calls).toEqual([
      ['sending', 'sync-1'],
      ['sent', {
        id: 'sync-1',
        server_document_id: 'server-id',
        server_document_number: 'B-BOLD-01-100',
      }],
    ])
    expect(result.sync_status).toBe('success')
    expect(result.pending_count).toBe(0)
  })
})
