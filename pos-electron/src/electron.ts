import {
  Customer,
  HeldSale,
  OfflineAccountingContext,
  Product,
  Seller,
  SyncState,
} from './types'

export type LocalSale = {
  sync_id: string
  invoice_number: string
  local_invoice_number?: string
  server_invoice_id?: string | null
  server_invoice_number?: string | null
  synced_at?: string | null
  total: number
  created_at: string
  occurred_at?: string
  shift_id?: string | null
  cashier_id?: string | null
  seller_id?: string | null
  offline_session_id?: string | null
  terminal_sequence?: string | null
  sync_status: string
  payment_method?: string
  customer_phone?: string | null
  attempt_count?: number
  last_attempt_at?: string | null
  last_error?: string | null
}

export type BoldBridge = {
  search(query: string): Promise<Product[]>
  stock(variantId: string): Promise<number>
  sellers(): Promise<Seller[]>

  sale(payload: unknown): Promise<{
    sync_id: string
    invoice_number: string
    terminal_sequence: string
    occurred_at: string
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
  sync_mark_sending(id: string): Promise<{ ok: boolean }>
  sync_mark_sent(result: {
    id: string
    server_document_id?: string | null
    server_document_number?: string | null
  }): Promise<{ ok: boolean }>
  sync_mark_failed(result: {
    id: string
    error: string
    retryable: boolean
  }): Promise<{ ok: boolean }>
  sync_apply_pull(data: unknown): Promise<{ ok: boolean }>
  sync_get_status(): Promise<SyncState>
  sync_set_status(
    status: Partial<SyncState>,
  ): Promise<{ ok: boolean }>

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
