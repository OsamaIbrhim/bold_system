import { Product, SyncState } from './types'

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

  sync_get_outbox(): Promise<any[]>
  sync_mark_sent(ids: string[]): Promise<{ ok: boolean }>
  sync_apply_pull(data: unknown): Promise<{ ok: boolean }>
  sync_get_status(): Promise<SyncState>
  sync_set_status(
    status: Partial<SyncState>,
  ): Promise<{ ok: boolean }>

  secure_get(): Promise<any>
  secure_set_auth(auth: unknown): Promise<{ ok: boolean }>
  secure_set_device(device: unknown): Promise<{ ok: boolean }>
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