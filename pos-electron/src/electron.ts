<<<<<<< HEAD
import { Product, SyncState } from './types'
=======
import {
  Customer,
  HeldSale,
  OfflineAccountingContext,
  Product,
  SyncState,
} from './types'
>>>>>>> 27adfdb (ci: add migration-gate job and concurrency group)

export type LocalSale = {
  sync_id: string
  invoice_number: string
  total: number
  created_at: string
  sync_status: string
}

export type BoldBridge = {
  search(query: string): Promise<Product[]>
  stock(variantId: string): Promise<number>

  sale(payload: unknown): Promise<{
    sync_id: string
    ok: boolean
    replayed?: boolean
  }>

  print(
    invoice: unknown,
    lang: 'ar' | 'en',
  ): Promise<{
    ok: boolean
    printed?: boolean
    reason?: string
  }>

  local_sales(): Promise<LocalSale[]>
  held_sales(): Promise<HeldSale[]>
  hold_sale(payload: {
    items: Array<{
      variant_id: string
      qty: number
    }>
    customer: Customer | null
  }): Promise<HeldSale>
  resume_held_sale(id: string): Promise<HeldSale>
  delete_held_sale(id: string): Promise<{ ok: boolean }>

  sync_get_outbox(): Promise<any[]>
  sync_mark_sent(ids: string[]): Promise<{ ok: boolean }>
  sync_apply_pull(data: unknown): Promise<{ ok: boolean }>
  sync_get_status(): Promise<SyncState>
  sync_set_status(
    status: Partial<SyncState>,
  ): Promise<{ ok: boolean }>

<<<<<<< HEAD
  secure_get(): Promise<any>
  secure_set_auth(auth: unknown): Promise<{ ok: boolean }>
  secure_set_device(device: unknown): Promise<{ ok: boolean }>
=======
  api_bootstrap(): Promise<IpcEnvelope<any>>
  api_enroll(code: string, terminal: unknown): Promise<IpcEnvelope<any>>
  api_login(phone: string, password: string): Promise<IpcEnvelope<any>>
  api_logout(): Promise<IpcEnvelope<any>>
  api_request(request: {
    path: string
    method?: string
    body?: unknown
  }): Promise<IpcEnvelope<any>>
  api_clear_session(): Promise<IpcEnvelope<any>>
  api_clear_device(): Promise<IpcEnvelope<any>>
  api_issue_accounting(shiftId: string): Promise<IpcEnvelope<any>>
  api_clear_accounting(): Promise<IpcEnvelope<any>>
>>>>>>> 27adfdb (ci: add migration-gate job and concurrency group)
}

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: {
        message: string
        code: string
        field?: string
        request_id?: string
        status?: number
        details?: string[]
      }
    }

function resolveBridge(): BoldBridge {
  const runtimeWindow = (
    globalThis as typeof globalThis & {
      window?: {
        bold?: BoldBridge
      }
    }
  ).window

  if (!runtimeWindow?.bold) {
    throw new Error(
      'Electron preload bridge is unavailable',
    )
  }

  return runtimeWindow.bold
}

export const bold = new Proxy({} as BoldBridge, {
  get(_target, property: string | symbol) {
    const bridge = resolveBridge()
    const value = Reflect.get(
      bridge as unknown as object,
      property,
    )

    return typeof value === 'function'
      ? value.bind(bridge)
      : value
  },
})