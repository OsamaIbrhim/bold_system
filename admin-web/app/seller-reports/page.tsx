'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPatch, getStoredUser } from '@/lib/api'

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
  const [settings, setSettings] = useState<any | null>(null)
  const [overrideSeller, setOverrideSeller] = useState('')
  const [overrideRate, setOverrideRate] = useState('')
  const [overrideTarget, setOverrideTarget] = useState('')
  const [overrideBonus, setOverrideBonus] = useState('')

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

  useEffect(() => {
    apiGet('/sellers/commission-settings')
      .then(result => setSettings(result.settings))
      .catch(() => undefined)
  }, [])

  const saveDefaults = async () => {
    if (!settings) return
    setError('')
    try {
      setSettings(await apiPatch('/sellers/commission-settings', {
        default_rate: Number(settings.default_rate),
        default_target: settings.default_target === '' || settings.default_target === null ? null : Number(settings.default_target),
        default_bonus: Number(settings.default_bonus),
        period_length_days: Number(settings.period_length_days),
        period_anchor: new Date(settings.period_anchor).toISOString(),
      }))
      await run()
    } catch (saveError: any) { setError(saveError.message) }
  }

  const saveOverride = async () => {
    if (!overrideSeller) return
    setError('')
    try {
      await apiPatch(`/sellers/${overrideSeller}/commission-settings`, {
        rate: overrideRate === '' ? null : Number(overrideRate),
        target: overrideTarget === '' ? null : Number(overrideTarget),
        bonus: overrideBonus === '' ? null : Number(overrideBonus),
      })
      setOverrideRate(''); setOverrideTarget(''); setOverrideBonus('')
      await run()
    } catch (saveError: any) { setError(saveError.message) }
  }

  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">تقارير البائعين</h1>
    {actor?.role === 'owner' && settings && <div className="card space-y-3"><h2 className="font-bold">إعدادات العمولة التقديرية</h2><div className="grid grid-cols-1 md:grid-cols-5 gap-2"><label>النسبة العامة %<input className="input mt-1" type="number" min="0" max="100" step="0.01" value={settings.default_rate} onChange={event => setSettings({...settings, default_rate:event.target.value})}/></label><label>الهدف العام<input className="input mt-1" type="number" min="0" step="0.01" value={settings.default_target ?? ''} onChange={event => setSettings({...settings, default_target:event.target.value})}/></label><label>مكافأة الهدف<input className="input mt-1" type="number" min="0" step="0.01" value={settings.default_bonus} onChange={event => setSettings({...settings, default_bonus:event.target.value})}/></label><label>طول الدورة بالأيام<input className="input mt-1" type="number" min="1" max="366" value={settings.period_length_days} onChange={event => setSettings({...settings, period_length_days:event.target.value})}/></label><button className="btn-accent self-end" onClick={saveDefaults}>حفظ العام</button></div><div className="grid grid-cols-1 md:grid-cols-5 gap-2 border-t pt-3"><select className="select" value={overrideSeller} onChange={event=>setOverrideSeller(event.target.value)}><option value="">اختر بائعًا للتخصيص</option>{sellerOptions.map(row=><option key={row.seller.id} value={row.seller.id}>{row.seller.name}</option>)}</select><input className="input" type="number" placeholder="نسبة خاصة أو فارغ" value={overrideRate} onChange={event=>setOverrideRate(event.target.value)}/><input className="input" type="number" placeholder="هدف خاص أو فارغ" value={overrideTarget} onChange={event=>setOverrideTarget(event.target.value)}/><input className="input" type="number" placeholder="مكافأة خاصة أو فارغ" value={overrideBonus} onChange={event=>setOverrideBonus(event.target.value)}/><button className="btn" disabled={!overrideSeller} onClick={saveOverride}>حفظ تخصيص البائع</button></div><p className="text-sm text-gray-600">القيم المعروضة تقديرية فقط ولا تعني أن العمولة دُفعت.</p></div>}
    <div className="card grid grid-cols-1 md:grid-cols-5 gap-2">
      <label>من<input className="input mt-1" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>إلى<input className="input mt-1" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      {actor?.role === 'owner' && <label>الفرع<select className="select mt-1" value={branchId} onChange={event => { setBranchId(event.target.value); setSellerId('') }}><option value="">كل الفروع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name_ar}</option>)}</select></label>}
      <label>البائع<select className="select mt-1" value={sellerId} onChange={event => setSellerId(event.target.value)}><option value="">كل البائعين</option>{sellerOptions.map(row => <option key={row.seller.id} value={row.seller.id}>{row.seller.name}</option>)}</select></label>
      <button className="btn-accent self-end" disabled={loading || !from || !to} onClick={run}>{loading ? 'جارٍ التحميل…' : 'عرض التقرير'}</button>
    </div>
    {error && <div className="card text-red-700" role="alert">{error}</div>}
    <div className="card overflow-auto"><table><thead><tr><th>البائع</th><th>الفرع</th><th>الفواتير</th><th>إجمالي قبل الضريبة</th><th>المرتجعات</th><th>صافي المبيعات</th><th>النسبة</th><th>عمولة النسبة</th><th>مكافأة الهدف</th><th>الإجمالي التقديري</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.seller.id}><td>{row.seller.name}</td><td>{row.seller.branch?.name_ar || '—'}</td><td>{row.invoice_count}</td><td>{Number(row.gross_sales_before_tax).toFixed(2)}</td><td>{Number(row.returns_before_tax).toFixed(2)}</td><td className="font-bold">{Number(row.net_sales_before_tax).toFixed(2)}</td><td>{row.commission_rate}%</td><td>{Number(row.percentage_commission).toFixed(2)}</td><td>{Number(row.target_bonus).toFixed(2)} {row.target_achieved ? '✓' : ''}</td><td className="font-bold">{Number(row.estimated_total).toFixed(2)}</td></tr>)}
      {!rows.length && <tr><td colSpan={10} className="text-center py-8 text-gray-500">لا توجد مبيعات بائعين في الفترة المحددة.</td></tr>}
    </tbody></table></div>
  </div>
}
