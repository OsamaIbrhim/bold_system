'use client'
import { useState } from 'react'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
export default function Customers(){
  const [phone,setPhone] = useState('')
  const [list,setList] = useState<any[]>([])
  const [name,setName] = useState('')
  const [whatsapp,setWhatsapp] = useState('')
  const [email,setEmail] = useState('')
  const search = async ()=> { const r = await apiGet(`/customers?q=${encodeURIComponent(phone||'')}`); const arr = Array.isArray(r) ? r : r ? [r] : []; setList(arr) }
  const create = async ()=> { await apiPost('/customers', { name, phone, whatsapp: whatsapp || phone, email: email || null }); setName('');setPhone('');setWhatsapp('');setEmail(''); search() }
  const toggleVip = async(id:string,v:boolean)=>{ await apiPost(`/customers/${id}/vip`, {is_vip:v}); search() }
  const del = async(id:string)=>{ if(!confirm('حذف العميل؟'))return; try{ await apiDelete(`/customers/${id}`); search() }catch(e:any){ alert('فشل: '+e.message)}}
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">العملاء / الولاء</h1>
  <div className="card"><h2 className="font-bold mb-2">عميل جديد</h2>
  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
  <input className="input" placeholder="الاسم" value={name} onChange={e=>setName(e.target.value)} />
  <input className="input" placeholder="الهاتف *" value={phone} onChange={e=>setPhone(e.target.value)} />
  <input className="input" placeholder="واتساب" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} />
  <input className="input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
  <button className="btn-accent" onClick={create}>حفظ</button></div></div>
  <div className="card"><div className="flex gap-2 mb-3">
  <input className="input" placeholder="بحث بالهاتف / الاسم" value={phone} onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} />
  <button className="btn" onClick={search}>بحث</button></div>
  <table><thead><tr><th>الاسم</th><th>الهاتف</th><th>فواتير</th><th>إجمالي</th><th>VIP</th><th></th></tr></thead>
  <tbody>{list.map((c:any)=><tr key={c.id}><td>{c.name||'-'}</td><td>{c.phone}</td><td>{c.total_invoices||0}</td><td>{Number(c.total_spent||0)} ج</td><td>{c.is_vip?'⭐':'-'}</td><td>
  <button className="text-sm px-2" onClick={()=>toggleVip(c.id,!c.is_vip)}>{c.is_vip?'إلغاء VIP':'ترقية VIP'}</button>
  <button className="text-red-600 text-sm px-2" onClick={()=>del(c.id)}>حذف</button>
  </td></tr>)}</tbody></table></div></div>)
}
