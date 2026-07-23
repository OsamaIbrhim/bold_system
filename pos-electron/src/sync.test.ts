import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  isRetryableSyncError,
  performSync,
  SyncIntegrityError,
} from './sync'

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
      catalog_valid_until: null,
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
        cursor: '1',
        has_more: false,
        server_time: '2026-07-21T00:00:00.000Z',
        catalog_valid_until: '2026-07-22T00:00:00.000Z',
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
    expect(result.catalog_valid_until).toBe('2026-07-22T00:00:00.000Z')
  })

  it('finishes more than ten delta pages before restoring catalog validity', async () => {
    const applied: any[] = []
    const status = {
      device_id: 'device',
      terminal_name: 'POS',
      app_version: '1',
      sync_status: 'success',
      last_sync_at: null,
      last_error: null,
      pending_count: 0,
      sync_cursor: '0',
      catalog_valid_until: 'old-validity',
    }
    const local: any = {
      sync_get_status: async () => status,
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [],
      sync_mark_sending: async () => ({ ok: true }),
      sync_mark_sent: async () => ({ ok: true }),
      sync_mark_failed: async () => ({ ok: true }),
      sync_apply_pull: async (value: any) => {
        applied.push(value)
        return { ok: true }
      },
    }
    let page = 0
    const client: any = {
      heartbeat: async () => ({}),
      sale: async () => ({}),
      pull: async () => {
        page += 1
        return {
          products: [],
          stock: [],
          cursor: String(page),
          has_more: page < 12,
          server_time: `page-${page}`,
          catalog_valid_until: `valid-${page}`,
        }
      },
    }

    const result = await performSync(
      'branch-1',
      local,
      client,
    )

    expect(applied).toHaveLength(12)
    expect(
      applied.slice(0, -1).every(
        (value) =>
          value.catalog_valid_until === null,
      ),
    ).toBe(true)
    expect(
      applied[applied.length - 1]
        .catalog_valid_until,
    ).toBe('valid-12')
    expect(result.sync_cursor).toBe('12')
    expect(result.catalog_valid_until).toBe(
      'valid-12',
    )
  })

  it('rejects a has_more response whose cursor does not advance', async () => {
    let applied = false
    const local: any = {
      sync_get_status: async () => ({
        device_id: 'device',
        terminal_name: 'POS',
        app_version: '1',
        sync_status: 'success',
        last_sync_at: null,
        last_error: null,
        pending_count: 0,
        sync_cursor: '5',
        catalog_valid_until: 'valid',
      }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [],
      sync_apply_pull: async () => {
        applied = true
        return { ok: true }
      },
    }
    const client: any = {
      heartbeat: async () => ({}),
      pull: async () => ({
        products: [],
        stock: [],
        cursor: '5',
        has_more: true,
      }),
    }

    await expect(
      performSync('branch-1', local, client),
    ).rejects.toBeInstanceOf(
      SyncIntegrityError,
    )
    expect(applied).toBe(false)
  })

  it('rejects a final response that moves the cursor backwards', async () => {
    const local: any = {
      sync_get_status: async () => ({
        device_id: 'device',
        terminal_name: 'POS',
        app_version: '1',
        sync_status: 'success',
        last_sync_at: null,
        last_error: null,
        pending_count: 0,
        sync_cursor: '5',
        catalog_valid_until: 'valid',
      }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [],
      sync_apply_pull: async () => {
        throw new Error(
          'A regressing cursor must not be applied',
        )
      },
    }
    const client: any = {
      heartbeat: async () => ({}),
      pull: async () => ({
        products: [],
        stock: [],
        cursor: '4',
        has_more: false,
      }),
    }

    await expect(
      performSync('branch-1', local, client),
    ).rejects.toBeInstanceOf(
      SyncIntegrityError,
    )
  })
})
