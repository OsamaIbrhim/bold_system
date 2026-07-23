export type User = {
  id: string
  name: string
  role: 'branch_manager' | 'cashier'
  branch_id: string
}

export type Session = {
  user: User
}

<<<<<<< HEAD
=======
export type {
  OfflineAccountingSummary as OfflineAccountingContext,
} from '../electron/offline-accounting'

>>>>>>> 27adfdb (ci: add migration-gate job and concurrency group)
export type DeviceCredential = {
  device_id: string
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
  returned_qty?: number
  returnable_qty?: number
  return_items?: ReturnedInvoiceItem[]
  variant?: {
    sku?: string
    size?: string | null
    color?: string | null
    product?: {
      name_ar?: string
      name_en?: string
    }
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
  original_returns?: ReturnRecord[]
  _count?: {
    items: number
    original_returns: number
  }
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

export type HeldSale = {
  id: string
  customer: Customer | null
  items: CartItem[]
  item_count: number
  total: number
  created_at: string
  updated_at: string
  resume_error?: string | null
}

export type ReturnRecord = {
  id: string
  return_invoice_number: string
  original_invoice_id: string
  branch_id: string
  reason?: string | null
  is_partial: boolean
  refund_subtotal: number | string
  refund_tax: number | string
  refund_total: number | string
  status: 'completed' | 'voided'
  created_at: string
  created_by?: string | null
  _count?: {
    items: number
  }
  original_invoice?: {
    id: string
    invoice_number: string
    total: number | string
    payment_method: string
    customer?: {
      id: string
      name?: string | null
      phone: string
      } | null
    terminal?: {
      id: string
      terminal_code: string
      name: string
      } | null
  }
}

export type ReturnedInvoiceItem = {
  qty: number
}