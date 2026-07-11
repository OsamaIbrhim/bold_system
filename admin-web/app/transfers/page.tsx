'use client'
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
export default function Transfers(){
  const [rows,setRows]=useState<any[]>([])
  const [from,setFrom]=useState(''), [to,setTo]=useState('')
  const load = async()=>{ const r = await apiGet('/transfers'); setRows(r||[]) }
  useEffect(()=>{ load() },[])
  const create = async()=>{ if(!from||!to) return alert('اختر الفرعين'); await apiPost('/transfers',{from_branch_id:from,to_branch_id:to}); load() }
  const receive = async(id:string)=>{ await apiPost(`/transfers/${id}/receive`,{items:[]}); load() }
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">التحويلات بين الفروع</h1>
  <div className="card"><h2 className="font-bold mb-2">تحويل جديد</h2>
  <div className="flex gap-2">
  <input className="input" placeholder="From Branch UUID" value={from} onChange={e=>setFrom(e.target.value)} />
  <input className="input" placeholder="To Branch UUID" value={to} onChange={e=>setTo(e.target.value)} />
  <button className="btn-accent" onClick={create}>إنشاء</button></div>
  <div className="text-xs text-gray-500 mt-2">بعد الإنشاء: /transfers/:id/ship ثم /transfers/:id/receive – يتم نقل المخزون تلقائيا</div></div>
  <div className="card"><table><thead><tr><th>الرقم</th><th>من</th><th>إلى</th><th>الحالة</th><th></th></tr></thead>
  <tbody>{rows.map((t:any)=><tr key={t.id}><td>{t.transfer_number}</td><td className="font-mono text-xs">{t.from_branch_id?.slice(0,8)}</td><td className="font-mono text-xs">{t.to_branch_id?.slice(0,8)}</td><td>{t.status}</td><td>{t.status!=='received' && <button className="btn" onClick={()=>receive(t.id)}>استلام</button>}</td></tr>)}
  {!rows.length && <tr><td colSpan={5} className="text-center text-gray-500 py-4">لا توجد تحويلات</td></tr>}
  </tbody></table></div></div>)
}
