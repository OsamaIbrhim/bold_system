'use client'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

export default function Reports(){
  const [from,setFrom] = useState(new Date().toISOString().slice(0,10))
  const [to,setTo] = useState(new Date().toISOString().slice(0,10))
  const [branch,setBranch] = useState('')
  const [res,setRes] = useState<any>(null)
  const [sending,setSending] = useState(false)

  const run = async ()=> { const r = await apiGet(`/reports/sales?from=${from}&to=${to}${branch?`&branch_id=${branch}`:''}`); setRes(r) }
  const send = async (channels: string[]) => {
    setSending(true)
    try { const r = await apiPost('/reports/send', { from, to, branch_id: branch||undefined, channels }); alert('تم الإرسال ✓\n' + JSON.stringify(r)) }
    catch(e:any){ alert('خطأ: '+e.message) }
    finally { setSending(false) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">التقارير</h1>
      <div className="card flex flex-wrap gap-2 items-end">
        <div><label className="text-sm">من</label><input type="date" className="input" value={from} onChange={e=>setFrom(e.target.value)} /></div>
        <div><label className="text-sm">إلى</label><input type="date" className="input" value={to} onChange={e=>setTo(e.target.value)} /></div>
        <div><label className="text-sm">Branch UUID (اختياري)</label><input className="input" placeholder="branch_id" value={branch} onChange={e=>setBranch(e.target.value)} /></div>
        <button className="btn" onClick={run}>تشغيل</button>
        <button className="btn-accent" disabled={sending} onClick={()=>send(['email'])}>إرسال Email</button>
        <button className="btn-accent" disabled={sending} onClick={()=>send(['whatsapp'])}>إرسال WhatsApp</button>
        <button className="btn" disabled={sending} onClick={()=>send(['email','whatsapp'])}>الاثنين معاً</button>
      </div>
      {res && (
        <div className="card">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-gray-500 text-sm">المبيعات</div><div className="text-2xl font-bold">{Number(res.total_sales).toFixed(2)} ج</div></div>
            <div><div className="text-gray-500 text-sm">التكلفة</div><div className="text-2xl font-bold">{Number(res.total_cost).toFixed(2)} ج</div></div>
            <div><div className="text-gray-500 text-sm">الربح</div><div className="text-2xl font-bold text-green-700">{Number(res.profit).toFixed(2)} ج</div></div>
          </div>
          <div className="text-sm text-gray-500 mt-3">عدد الفواتير: {res.count}</div>
          <div className="mt-3 text-sm">
            PDF فاتورة تجريبي: <a className="text-blue-600 underline" target="_blank" href={`http://localhost:3000/api/v1/sales/REPLACE_WITH_INVOICE_ID/pdf?lang=ar`}>AR PDF</a> · <a className="text-blue-600 underline" target="_blank" href={`http://localhost:3000/api/v1/sales/REPLACE_WITH_INVOICE_ID/pdf?lang=en`}>EN PDF</a>
          </div>
        </div>
      )}
      <div className="text-xs text-gray-500">التقارير اليومية تُرسل تلقائياً بعد الإغلاق – الأسبوع السبت→الجمعة – المالك يستلم دائماً</div>
    </div>
  )
}
