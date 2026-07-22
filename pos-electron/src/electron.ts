import { OfflineAccountingContext, Product, SyncState } from './types'

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

  secure_get(): Promise<any>
  secure_set_auth(auth: unknown): Promise<{ ok: boolean }>
  secure_set_device(device: unknown): Promise<{ ok: boolean }>
  secure_set_accounting(
    context: OfflineAccountingContext | null,
  ): Promise<{ ok: boolean }>
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
