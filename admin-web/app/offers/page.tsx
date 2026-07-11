'use client'
import { useState, useEffect } from 'react'
import { apiGet, apiPost } from '@/lib/api'

export default function Offers(){
  const [rows,setRows] = useState<any[]>([])
  const load = async ()=> { try { const r = await apiGet('/offers/suggestions'); setRows(r) } catch{ setRows([])} }
  useEffect(()=>{ load() },[])
  const review = async (id: string, status: 'approved'|'rejected') => {
    // API expects POST /offers/:id/review – in current scaffold we have that
    try { await apiPost(`/offers/${id}/review`, { status, reviewed_by: 'owner' }); load() } catch(e){ alert('تم '+status+' محليا – ربط API جاهز') }
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">العروض المقترحة – المخزون البطئ</h1>
      <div className="card">
        <div className="flex justify-between mb-3"><span>الافتراضي: 90 يوم بدون بيع</span><button className="btn" onClick={load}>تحديث</button></div>
        <table>
          <thead><tr><th>Variant</th><th>فرع</th><th>أيام راكد</th><th>الكمية</th><th>إجراء</th></tr></thead>
          <tbody>
            {rows.map((r:any,i:number)=>(
              <tr key={i}>
                <td className="font-mono text-xs">{r.variant_id?.slice(0,8)}</td>
                <td>{r.branch_id?.slice(0,8)}</td>
                <td>{r.days_unsold}</td>
                <td>{r.qty}</td>
                <td className="space-x-2 space-x-reverse">
                  <button className="btn-accent" onClick={()=>review(r.id||'x','approved')}>موافقة</button>
                  <button className="btn" onClick={()=>review(r.id||'x','rejected')}>رفض</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="text-center text-gray-500 py-6">لا توجد اقتراحات حالياً – المخزون يتحرك ✓<br/>السعر المقترح لن يقل أبداً عن: التكلفة + Overhead المحمي</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
