'use client'
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

/**
 * WP-008 Phase B: the response shape of `POST /pricing/calculate`, mirroring
 * `PriceQuote` in `backend/src/pricing/pricing.service.ts`. Typed explicitly —
 * the previous `any` here let this page keep reading `cost`/`overhead_percent`/
 * `profit_percent` (fields the Phase B engine no longer returns) while still
 * compiling clean, so the page rendered `undefined` in production.
 *
 * `min_allowed_price` and `source` are optional because the backend strips
 * them for a caller without `pricing.cost.view`/`pricing.margin.view`
 * (BR-CST-101, Permission Matrix §51: no cost/margin visibility for a
 * cashier — the floor can be cost-derived).
 */
type PriceQuote = {
  qty: number
  unit_price: number
  net_price: number
  tax_percent: number
  tax_amount: number
  selling_price: number
  min_allowed_price?: number
  source?: {
    price_book_id: string
    entry_id: string
    scope_type: 'variant' | 'product' | 'brand' | 'category' | 'global'
    scope_id: string | null
    min_qty: number
  }
}

type VariantOption = {
  id: string
  sku: string
  product?: { name_ar?: string | null; name_en?: string | null } | null
}

const SCOPE_LABELS: Record<NonNullable<PriceQuote['source']>['scope_type'], string> = {
  variant: 'المنتج (Variant)',
  product: 'المنتج الأساسي',
  brand: 'العلامة التجارية',
  category: 'التصنيف',
  global: 'الافتراضي العام',
}

export default function Pricing() {
  const [variant, setVariant] = useState('')
  const [qty, setQty] = useState(1)
  const [products, setProducts] = useState<VariantOption[]>([])
  const [res, setRes] = useState<PriceQuote | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiGet('/products?page=1&page_size=100')
      .then(r => setProducts(r.items || []))
      .catch((e: any) => setError(e.message))
  }, [])

  const calc = async () => {
    try {
      setRes(await apiPost('/pricing/calculate', { variant_id: variant, qty }))
      setError('')
    } catch (e: any) {
      setRes(null)
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">محرك التسعير</h1>
      <div className="card">
        <div className="flex gap-2 mb-3">
          <select className="select" value={variant} onChange={e => setVariant(e.target.value)}>
            <option value="">اختر المنتج / SKU</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.sku} – {p.product?.name_ar || p.product?.name_en}
              </option>
            ))}
          </select>
          <input
            className="select"
            type="number"
            min={1}
            value={qty}
            onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}
            aria-label="الكمية"
          />
          <button className="btn" disabled={!variant} onClick={calc}>احسب</button>
        </div>
        {error && <div className="text-red-700">{error}</div>}
        {res && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <span className="text-gray-500 text-sm">السعر قبل الضريبة</span>
              <div className="font-bold">{res.net_price} ج</div>
            </div>
            <div>
              <span className="text-gray-500 text-sm">الضريبة</span>
              <div>{res.tax_amount} ج ({res.tax_percent}%)</div>
            </div>
            <div>
              <span className="text-gray-500 text-sm">سعر البيع</span>
              <div className="text-xl font-bold">{res.selling_price} ج</div>
            </div>
            <div>
              <span className="text-gray-500 text-sm">الحد الأدنى</span>
              <div className="text-amber-700 font-bold">
                {res.min_allowed_price != null ? `${res.min_allowed_price} ج` : '—'}
              </div>
            </div>
            {res.source && (
              <div className="col-span-2 md:col-span-4 text-sm text-gray-600">
                مصدر السعر: {SCOPE_LABELS[res.source.scope_type]} — كمية لا تقل عن {res.source.min_qty}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="card text-sm text-gray-600">
        الأولوية: Variant ← Product ← Brand ← Category ← Global. السعر النهائي يحسب في الخادم من Price Book فعالة،
        ولا يعتمد على سعر يرسله POS. لا يوجد سعر ⇐ يمنع البيع (BR-PSL-101).
      </div>
    </div>
  )
}
