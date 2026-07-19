import { api } from './api'

export type SyncState = {
  device_id: string
  terminal_name: string
  app_version: string
  sync_status: 'never'|'syncing'|'success'|'error'|'offline'
  last_sync_at: string|null
  last_error: string|null
  pending_count: number
}

type SyncBridge = {
  sync_get_outbox(): Promise<any[]>
  sync_mark_sent(ids:string[]): Promise<any>
  sync_apply_pull(data:any): Promise<any>
  sync_get_status(): Promise<SyncState>
  sync_set_status(status:Partial<SyncState>): Promise<any>
}

type SyncApi = {
  sale(payload:any): Promise<any>
  pull(branchId:string): Promise<any>
  heartbeat(payload:any): Promise<any>
}

const bridge = () => (window as any).bold as SyncBridge
let activeSync: Promise<SyncState> | null = null

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown synchronization error')
}

async function publishHeartbeat(client: SyncApi, state: SyncState) {
  return client.heartbeat({
    device_id: state.device_id,
    name: state.terminal_name,
    app_version: state.app_version,
    sync_status: state.sync_status,
    last_sync_at: state.last_sync_at || undefined,
    last_error: state.last_error || undefined,
    pending_count: state.pending_count,
  })
}

export async function performSync(branchId: string, local: SyncBridge, client: SyncApi): Promise<SyncState> {
  let state = await local.sync_get_status()
  await local.sync_set_status({ sync_status: 'syncing', last_error: null })
  state = { ...state, sync_status: 'syncing', last_error: null }
  await publishHeartbeat(client, state)

  const outbox = await local.sync_get_outbox()
  for (const item of outbox) {
    try {
      await client.sale(JSON.parse(item.payload))
      await local.sync_mark_sent([item.id])
    } catch (error) {
      const message = errorMessage(error)
      const current = await local.sync_get_status()
      const failed = { ...state, sync_status: 'error' as const, last_error: message, pending_count: current.pending_count }
      await local.sync_set_status(failed)
      await publishHeartbeat(client, failed).catch(() => undefined)
      return failed
    }
  }

  // A cashier can complete another local sale while network requests are in
  // flight. Re-check before pulling so that snapshot stock never overwrites a
  // reservation created after the first outbox read.
  const remaining = await local.sync_get_outbox()
  if (remaining.length) {
    const pending = {
      ...state,
      sync_status: 'error' as const,
      last_error: 'A new sale was queued during synchronization; retrying before the next snapshot.',
      pending_count: remaining.length,
    }
    await local.sync_set_status(pending)
    await publishHeartbeat(client, pending).catch(() => undefined)
    return pending
  }

  const snapshot = await client.pull(branchId)
  await local.sync_apply_pull(snapshot)
  const completed = {
    ...state,
    sync_status: 'success' as const,
    last_sync_at: snapshot.server_time || new Date().toISOString(),
    last_error: null,
    pending_count: 0,
  }
  await local.sync_set_status(completed)
  await publishHeartbeat(client, completed)
  return completed
}

export function syncLoop(branchId: string, onStatus?: (state:SyncState)=>void): Promise<SyncState> {
  if (activeSync) return activeSync
  activeSync = performSync(branchId, bridge(), api).catch(async(error) => {
    const local = bridge()
    const previous = await local.sync_get_status()
    const offline = {
      ...previous,
      sync_status: 'offline' as const,
      last_error: errorMessage(error),
    }
    await local.sync_set_status(offline)
    return offline
  }).then((state) => { onStatus?.(state); return state }).finally(() => { activeSync = null })
  return activeSync
}

export function startSync(branchId: string, onStatus?: (state:SyncState)=>void) {
  bridge().sync_get_status().then(state => onStatus?.(state))
  syncLoop(branchId, onStatus)
  const timer = setInterval(()=>syncLoop(branchId, onStatus), 15000)
  const online = () => syncLoop(branchId, onStatus)
  window.addEventListener('online', online)
  return () => { clearInterval(timer); window.removeEventListener('online', online) }
}
