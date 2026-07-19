'use client'
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

export default function Reports(){
  const [from,setFrom] = useState(new Date().toISOString().slice(0,10))
  const [to,setTo] = useState(new Date().toISOString().slice(0,10))
  const [branch,setBranch] = useState('')
  const [res,setRes] = useState<any>(null)
  const [profitItems,setProfitItems] = useState<any[]>([])
  const [invVal,setInvVal] = useState<any>(null)
  const [sending,setSending] = useState(false)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [branches,setBranches] = useState<any[]>([])
  const [tab,setTab] = useState<'sales'|'profit'|'inventory'>('sales')

  useEffect(()=>{apiGet('/branches').then(setBranches).catch(()=>undefined)},[])

  const execute = async (operation:()=>Promise<void>) => {
    setLoading(true); setError('')
    try { await operation() }
    catch(e:any) { setError(`${e.message||'تعذر إنشاء التقرير'}${e.requestId?` — المرجع: ${e.requestId}`:''}`) }
    finally { setLoading(false) }
  }

  const runSales = ()=>execute(async()=> {
    const r = await apiGet(`/reports/sales?from=${from}&to=${to}${branch?`&branch_id=${branch}`:''}`); 
    setRes(r); setTab('sales')
  })
  const runProfit = ()=>execute(async()=> {
    const r = await apiGet(`/reports/profit-by-item?from=${from}&to=${to}${branch?`&branch_id=${branch}`:''}`);
    setProfitItems(Array.isArray(r)?r:[]); setTab('profit')
  })
  const runInv = ()=>execute(async()=> {
    const r = await apiGet(`/reports/inventory-valuation${branch?`?branch_id=${branch}`:''}`);
    setInvVal(r); setTab('inventory')
  })
  const send = async (channels: string[]) => {
    setSending(true)
    try { await apiPost('/reports/send', { from, to, branch_id: branch||undefined, channels }); alert('تم الإرسال ✓') }
    catch(e:any){ alert('خطأ: '+e.message) }
    finally { setSending(false) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">التقارير</h1>
      <div className="card flex flex-wrap gap-2 items-end">
        <div><label className="text-sm">من</label><input type="date" className="input" value={from} onChange={e=>setFrom(e.target.value)} /></div>
        <div><label className="text-sm">إلى</label><input type="date" className="input" value={to} onChange={e=>setTo(e.target.value)} /></div>
        <div><label className="text-sm">الفرع (اختياري)</label><select className="select" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">كل الفروع المتاحة</option>{branches.map(item=><option key={item.id} value={item.id}>{item.name_ar||item.name_en||item.code}</option>)}</select></div>
        <button className="btn" disabled={loading} onClick={runSales}>مبيعات</button>
        <button className="btn" disabled={loading} onClick={runProfit}>ربح لكل صنف</button>
        <button className="btn" disabled={loading} onClick={runInv}>تقييم المخزون</button>
        <button className="btn-accent" disabled={sending} onClick={()=>send(['email'])}>Email</button>
        <button className="btn-accent" disabled={sending} onClick={()=>send(['whatsapp'])}>WhatsApp</button>
      </div>

      {error&&<div className="card border border-red-200 bg-red-50 text-red-800" role="alert">{error}</div>}
      {loading&&<div className="card text-center text-gray-500">جارٍ إعداد التقرير…</div>}
      {!loading&&!error&&tab==='sales'&&!res&&<div className="card text-center text-gray-500 py-10">اختر الفترة والفرع، ثم اختر نوع التقرير لعرض النتائج هنا.</div>}

      {tab==='sales' && res && (
        <div className="card">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-gray-500 text-sm">المبيعات</div><div className="text-2xl font-bold">{Number(res.total_sales).toFixed(2)} ج</div></div>
            <div><div className="text-gray-500 text-sm">التكلفة</div><div className="text-2xl font-bold">{Number(res.total_cost).toFixed(2)} ج</div></div>
            <div><div className="text-gray-500 text-sm">الربح</div><div className="text-2xl font-bold text-green-700">{Number(res.profit).toFixed(2)} ج</div></div>
          </div>
          <div className="text-sm text-gray-500 mt-3">عدد الفواتير: {res.count}</div>
        </div>
      )}

      {tab==='profit' && (
        <div className="card overflow-auto">
          <h2 className="font-bold mb-2">الربح لكل صنف</h2>
          <table><thead><tr><th>الصنف</th><th>الكمية</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th></tr></thead>
          <tbody>{profitItems.map((p:any)=><tr key={p.variant_id}><td>{p.name}</td><td>{p.qty}</td><td>{p.revenue.toFixed(0)}</td><td>{p.cost.toFixed(0)}</td><td className="font-bold text-green-700">{p.profit.toFixed(0)}</td></tr>)}
          {!profitItems.length && <tr><td colSpan={5} className="text-center text-gray-500 py-4">لا توجد مبيعات مطابقة في الفترة المحددة.</td></tr>}
          </tbody></table>
        </div>
      )}

      {tab==='inventory' && invVal && (
        <div className="card">
          <h2 className="font-bold mb-2">تقييم المخزون – إجمالي القيمة: {Number(invVal.total_value||0).toFixed(2)} ج – الكمية: {invVal.total_qty||0}</h2>
          <div className="max-h-96 overflow-auto">
          <table><thead><tr><th>الفرع</th><th>SKU</th><th>المنتج</th><th>الكمية</th><th>التكلفة</th><th>القيمة</th></tr></thead>
          <tbody>{(invVal.rows||[]).slice(0,100).map((r:any,i:number)=><tr key={i}><td>{r.branch}</td><td>{r.sku}</td><td>{r.product} {r.size||''} {r.color||''}</td><td>{r.qty}</td><td>{r.cost_price}</td><td>{r.value.toFixed(0)}</td></tr>)}</tbody>
          </table>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">التقارير اليومية تُرسل تلقائياً – الأسبوع السبت→الجمعة – فاتورة PDF: /api/v1/sales/:id/pdf?lang=ar|en</div>
    </div>
  )
}
