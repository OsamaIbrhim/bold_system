import { api } from './api'
import { bold, BoldBridge } from './electron'
import { SyncState } from './types'

type SyncBridge = Pick<
  BoldBridge,
  | 'sync_get_status'
  | 'sync_set_status'
  | 'sync_get_outbox'
  | 'sync_mark_sent'
  | 'sync_apply_pull'
>

type SyncApi = Pick<
  typeof api,
  'sale' | 'pull' | 'heartbeat'
>

let activeSync: Promise<SyncState> | null = null

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : String(
        error || 'Unknown synchronization error',
      )
}

async function publishHeartbeat(
  client: SyncApi,
  state: SyncState,
) {
  return client.heartbeat({
    device_id: state.device_id,
    name: state.terminal_name,
    app_version: state.app_version,
    sync_status: state.sync_status,
    last_sync_at:
      state.last_sync_at || undefined,
    last_error:
      state.last_error || undefined,
    pending_count: state.pending_count,
  })
}

export async function performSync(
  branchId: string,
  local: SyncBridge,
  client: SyncApi,
): Promise<SyncState> {
  let state = await local.sync_get_status()

  await local.sync_set_status({
    sync_status: 'syncing',
    last_error: null,
  })

  state = {
    ...state,
    sync_status: 'syncing',
    last_error: null,
  }

  await publishHeartbeat(client, state)

  const outbox = await local.sync_get_outbox()

  for (const item of outbox) {
    try {
      const stored = JSON.parse(item.payload)

      // إزالة الحقول المحلية التي لا يقبلها Backend DTO
      const {
        local_total: _localTotal,
        ...payload
      } = stored

      await client.sale(payload)
      await local.sync_mark_sent([item.id])
    } catch (error) {
      const current =
        await local.sync_get_status()

      const failed: SyncState = {
        ...state,
        sync_status: 'error',
        last_error: errorMessage(error),
        pending_count: current.pending_count,
      }

      await local.sync_set_status(failed)

      await publishHeartbeat(
        client,
        failed,
      ).catch(() => undefined)

      return failed
    }
  }

  // قد يضيف الكاشير عملية بيع جديدة أثناء
  // وجود طلبات المزامنة قيد التنفيذ.
  const remaining =
    await local.sync_get_outbox()

  if (remaining.length) {
    const pending: SyncState = {
      ...state,
      sync_status: 'error',
      last_error:
        'تمت إضافة عملية جديدة أثناء المزامنة؛ ستُرسل قبل تحديث المخزون.',
      pending_count: remaining.length,
    }

    await local.sync_set_status(pending)

    await publishHeartbeat(
      client,
      pending,
    ).catch(() => undefined)

    return pending
  }

  let cursor = state.sync_cursor || null
  let response: any
  let pages = 0

  do {
    response = await client.pull(
      branchId,
      cursor,
    )

    await local.sync_apply_pull(response)

    cursor = response.cursor ?? cursor
    pages += 1
  } while (
    response.has_more &&
    pages < 10
  )

  const completed: SyncState = {
    ...state,
    sync_status: 'success',
    last_sync_at:
      response.server_time ||
      new Date().toISOString(),
    last_error: null,
    pending_count: 0,
    sync_cursor: cursor,
  }

  await local.sync_set_status(completed)
  await publishHeartbeat(client, completed)

  return completed
}

export function syncLoop(
  branchId: string,
  onStatus?: (state: SyncState) => void,
): Promise<SyncState> {
  if (activeSync) {
    return activeSync
  }

  activeSync = performSync(
    branchId,
    bold,
    api,
  )
    .catch(async error => {
      const previous =
        await bold.sync_get_status()

      const offline: SyncState = {
        ...previous,
        sync_status: 'offline',
        last_error: errorMessage(error),
      }

      await bold.sync_set_status(offline)

      return offline
    })
    .then(state => {
      onStatus?.(state)
      return state
    })
    .finally(() => {
      activeSync = null
    })

  return activeSync
}

export function startSync(
  branchId: string,
  onStatus?: (state: SyncState) => void,
) {
  bold
    .sync_get_status()
    .then(state => onStatus?.(state))

  syncLoop(branchId, onStatus)

  const timer = setInterval(
    () => syncLoop(branchId, onStatus),
    15_000,
  )

  const online = () => {
    syncLoop(branchId, onStatus)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(
      'online',
      online,
    )
  }

  return () => {
    clearInterval(timer)

    if (typeof window !== 'undefined') {
      window.removeEventListener(
        'online',
        online,
      )
    }
  }
}