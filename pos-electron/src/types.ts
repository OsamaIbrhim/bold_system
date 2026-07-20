export type User = {
  id: string
  name: string
  role: 'branch_manager' | 'cashier'
  branch_id: string
}

export type Session = {
  access_token: string
  refresh_token: string
  user: User
}

export type DeviceCredential = {
  device_id: string
  device_token: string
  branch_id: string
  terminal_id: string
  terminal_code: string
}

export type Shift = {
  id: string
  branch_id: string
  opened_by: string
  opening_cash: number | string
  opened_at: string
  status: 'open' | 'closed'
  closing_cash?: number | string | null
  expected_cash?: number | string | null
  difference?: number | string | null
  closed_at?: string | null
}

export type Product = {
  id: string
  sku: string
  name_en?: string
  name_ar?: string
  barcode_ean13?: string | null
  barcode_internal?: string | null
  size?: string | null
  color?: string | null
  selling_price?: number | string
  unit_tax?: number | string
  qty?: number | string
}

export type CartItem = Product & {
  variant_id: string
  name: string
  qty: number
  unit_price: number
  unit_tax: number
  available_qty: number
}

export type Customer = {
  id?: string
  name?: string | null
  phone: string
  whatsapp?: string | null
  total_invoices?: number
  total_spent?: number | string
  is_vip?: boolean
}

export type InvoiceItem = {
  id: string
  variant_id: string
  qty: number
  unit_price: number | string
  unit_tax: number | string
  returnable_qty?: number
  variant?: {
    sku?: string
    size?: string | null
    color?: string | null
    product?: { name_ar?: string, name_en?: string }
  }
}

export type Invoice = {
  id: string
  invoice_number: string
  branch_id: string
  created_at: string
  subtotal: number | string
  tax_amount: number | string
  total: number | string
  payment_method: string
  status: string
  customer?: Customer | null
  cashier_id?: string
  terminal?: { id: string, terminal_code: string, name: string } | null
  items?: InvoiceItem[]
}

export type SyncState = {
  device_id: string
  terminal_name: string
  app_version: string
  sync_status: 'never' | 'syncing' | 'success' | 'error' | 'offline'
  last_sync_at: string | null
  last_error: string | null
  pending_count: number
  sync_cursor?: string | null
}

export type AppView = 'register' | 'sales'

export type SaleDraft = {
  id: string
  customer: Customer | null
  items: CartItem[]
  created_at: string
  updated_at: string
}
