import { describe, expect, it, vi } from 'vitest'
import { performSync } from './sync'

function setup() {
  const state = { device_id: '93de7eb8-4fbe-4f78-8c83-2fefea327ffc', terminal_name: 'Till 1', app_version: '1.0.0', sync_status: 'never' as const, last_sync_at: null, last_error: null, pending_count: 1 }
  const local = {
    sync_get_status: vi.fn().mockResolvedValue(state),
    sync_set_status: vi.fn().mockResolvedValue({ ok: true }),
    sync_get_outbox: vi.fn().mockResolvedValueOnce([{ id: 'sale-1', payload: '{"sync_id":"sale-1"}' }]).mockResolvedValue([]),
    sync_mark_sent: vi.fn().mockResolvedValue({ ok: true }),
    sync_apply_pull: vi.fn().mockResolvedValue({ ok: true }),
  }
  const client = {
    heartbeat: vi.fn().mockResolvedValue({ ok: true }),
    sale: vi.fn().mockResolvedValue({ id: 'invoice-1' }),
    pull: vi.fn().mockResolvedValue({ server_time: '2026-07-19T18:00:00.000Z', products: [], stock: [] }),
  }
  return { local, client }
}

describe('POS synchronization', () => {
  it('uploads the outbox before applying a fresh snapshot and records success', async () => {
    const { local, client } = setup()
    const result = await performSync('branch-1', local as any, client as any)
    expect(client.sale.mock.invocationCallOrder[0]).toBeLessThan(client.pull.mock.invocationCallOrder[0])
    expect(local.sync_mark_sent).toHaveBeenCalledWith(['sale-1'])
    expect(local.sync_apply_pull).toHaveBeenCalled()
    expect(result).toMatchObject({ sync_status: 'success', pending_count: 0, last_sync_at: '2026-07-19T18:00:00.000Z' })
  })

  it('keeps a rejected sale pending and does not overwrite local stock', async () => {
    const { local, client } = setup(); client.sale.mockRejectedValue(new Error('Insufficient stock'))
    const result = await performSync('branch-1', local as any, client as any)
    expect(client.pull).not.toHaveBeenCalled()
    expect(local.sync_mark_sent).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sync_status: 'error', last_error: 'Insufficient stock' })
  })

  it('keeps a rejected sale pending and does not overwrite local stock', async () => {
    const { local, client } = setup()

    client.sale.mockRejectedValue(
      new Error('Insufficient stock'),
    )

    const result = await performSync(
      'branch-1',
      local as any,
      client as any,
    )

    expect(client.pull).not.toHaveBeenCalled()
    expect(local.sync_apply_pull).not.toHaveBeenCalled()
    expect(local.sync_mark_sent).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      sync_status: 'error',
      last_error: 'Insufficient stock',
    })
  })

  it('does not pull when a new sale appears while the current upload is in flight', async () => {
    const { local, client } = setup()

    local.sync_get_outbox
      .mockResolvedValueOnce([
        {
          id: 'sale-1',
          payload: '{"sync_id":"sale-1"}',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sale-2',
          payload: '{"sync_id":"sale-2"}',
        },
      ])

    const result = await performSync(
      'branch-1',
      local as any,
      client as any,
    )

    expect(client.sale).toHaveBeenCalledTimes(1)
    expect(client.sale).toHaveBeenCalledWith({
      sync_id: 'sale-1',
    })

    expect(local.sync_mark_sent).toHaveBeenCalledTimes(1)
    expect(local.sync_mark_sent).toHaveBeenCalledWith([
      'sale-1',
    ])

    expect(client.pull).not.toHaveBeenCalled()
    expect(local.sync_apply_pull).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      sync_status: 'error',
      pending_count: 1,
    })
  })
})
