'use client'
import { useEffect, useState } from 'react'
import { apiGet, apiPost, getStoredUser } from '@/lib/api'

export default function Shifts(){
  const user=getStoredUser(); const [items,setItems]=useState<any[]>([]),[branches,setBranches]=useState<any[]>([]),[branch,setBranch]=useState(user?.branch_id||''),[opening,setOpening]=useState('0'),[error,setError]=useState('')
  const load=async()=>{try{const [s,b]=await Promise.all([apiGet(`/shifts${branch?`?branch_id=${branch}`:''}`),apiGet('/branches')]);setItems(s);setBranches(b)}catch(e:any){setError(e.message)}}
  useEffect(()=>{load()},[branch])
  const open=async()=>{if(!branch)return;try{await apiPost('/shifts/open',{branch_id:branch,opening_cash:Number(opening)});load()}catch(e:any){setError(e.message)}}
  const close=async(s:any)=>{const amount=prompt('النقد الفعلي عند الإغلاق:');if(amount===null)return;try{await apiPost(`/shifts/${s.id}/close`,{closing_cash:Number(amount)});load()}catch(e:any){setError(e.message)}}
  return <div className="space-y-4"><h1 className="text-2xl font-bold">الورديات</h1><div className="card flex flex-wrap gap-2 items-end"><div className="min-w-64"><label className="text-sm">الفرع</label><select className="select" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name_ar}</option>)}</select></div><div><label className="text-sm">رصيد الافتتاح</label><input className="input" type="number" min="0" step="0.01" value={opening} onChange={e=>setOpening(e.target.value)}/></div><button className="btn-accent" onClick={open} disabled={!branch}>فتح وردية</button>{error&&<div className="text-red-700 w-full">{error}</div>}</div>
    <div className="card overflow-auto"><table><thead><tr><th>الحالة</th><th>الافتتاح</th><th>الإغلاق</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th><th></th></tr></thead><tbody>{items.map(s=><tr key={s.id}><td>{s.status==='open'?'مفتوحة':'مغلقة'}</td><td>{new Date(s.opened_at).toLocaleString('ar-EG')}</td><td>{s.closed_at?new Date(s.closed_at).toLocaleString('ar-EG'):'—'}</td><td>{s.expected_cash===null?'—':`${Number(s.expected_cash).toFixed(2)} ج`}</td><td>{s.closing_cash===null?'—':`${Number(s.closing_cash).toFixed(2)} ج`}</td><td>{s.difference===null?'—':`${Number(s.difference).toFixed(2)} ج`}</td><td>{s.status==='open'&&<button className="btn" onClick={()=>close(s)}>إغلاق</button>}</td></tr>)}{!items.length&&<tr><td colSpan={7} className="text-center py-8 text-gray-500">لا توجد ورديات لهذا الفرع</td></tr>}</tbody></table></div></div>
}
