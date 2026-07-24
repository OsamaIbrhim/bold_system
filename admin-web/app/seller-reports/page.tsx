'use client'

import { useEffect, useState } from 'react'
import { apiGet, getStoredUser } from '@/lib/api'

function monthRange() {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

export default function SellerReportsPage() {
  const initial = monthRange()
  const actor = getStoredUser()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [branchId, setBranchId] = useState('')
  const [sellerId, setSellerId] = useState('')
  const [branches, setBranches] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [sellerOptions, setSellerOptions] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (actor?.role === 'owner') {
      apiGet('/branches').then(setBranches).catch(() => setBranches([]))
    }
  }, [actor?.role])

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ from, to })
      if (branchId) query.set('branch_id', branchId)
      if (sellerId) query.set('seller_id', sellerId)
      const result = await apiGet(`/sellers/report?${query}`)
      setRows(result.rows || [])
      if (!sellerId) setSellerOptions(result.rows || [])
    } catch (reportError: any) {
      setError(reportError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void run() }, [])

  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">تقارير البائعين</h1>
    <div className="card grid grid-cols-1 md:grid-cols-5 gap-2">
      <label>من<input className="input mt-1" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>إلى<input className="input mt-1" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      {actor?.role === 'owner' && <label>الفرع<select className="select mt-1" value={branchId} onChange={event => { setBranchId(event.target.value); setSellerId('') }}><option value="">كل الفروع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name_ar}</option>)}</select></label>}
      <label>البائع<select className="select mt-1" value={sellerId} onChange={event => setSellerId(event.target.value)}><option value="">كل البائعين</option>{sellerOptions.map(row => <option key={row.seller.id} value={row.seller.id}>{row.seller.name}</option>)}</select></label>
      <button className="btn-accent self-end" disabled={loading || !from || !to} onClick={run}>{loading ? 'جارٍ التحميل…' : 'عرض التقرير'}</button>
    </div>
    {error && <div className="card text-red-700" role="alert">{error}</div>}
    <div className="card overflow-auto"><table><thead><tr><th>البائع</th><th>الفرع</th><th>الفواتير</th><th>إجمالي قبل الضريبة</th><th>المرتجعات</th><th>صافي المبيعات</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.seller.id}><td>{row.seller.name}</td><td>{row.seller.branch?.name_ar || '—'}</td><td>{row.invoice_count}</td><td>{Number(row.gross_sales_before_tax).toFixed(2)}</td><td>{Number(row.returns_before_tax).toFixed(2)}</td><td className="font-bold">{Number(row.net_sales_before_tax).toFixed(2)}</td></tr>)}
      {!rows.length && <tr><td colSpan={6} className="text-center py-8 text-gray-500">لا توجد مبيعات بائعين في الفترة المحددة.</td></tr>}
    </tbody></table></div>
  </div>
}
