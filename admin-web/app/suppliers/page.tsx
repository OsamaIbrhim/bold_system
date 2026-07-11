'use client'
import { useState, useEffect } from 'react'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
export default function SuppliersPage(){
  const [rows,setRows]=useState<any[]>([])
  const [q,setQ]=useState('')
  const [name,setName]=useState(''), [company,setCompany]=useState(''), [phone,setPhone]=useState('')
  const load = async()=>{ const r = await apiGet(`/suppliers${q?`?q=${encodeURIComponent(q)}`:''}`); setRows(Array.isArray(r)?r:[]) }
  useEffect(()=>{ load() },[])
  const create = async()=>{ await apiPost('/suppliers', { name, company_name: company, phone, alias_names: [] }); setName(''); setCompany(''); setPhone(''); load() }
  const del = async(id:string)=>{ if(!confirm('حذف المورد؟'))return; try{ await apiDelete(`/suppliers/${id}`); load() }catch(e:any){ alert('فشل: '+e.message)}}
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">الموردين</h1>
  <div className="card"><h2 className="font-bold mb-2">إضافة مورد</h2>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
  <input className="input" placeholder="الاسم *" value={name} onChange={e=>setName(e.target.value)} />
  <input className="input" placeholder="اسم الشركة" value={company} onChange={e=>setCompany(e.target.value)} />
  <input className="input" placeholder="الهاتف" value={phone} onChange={e=>setPhone(e.target.value)} />
  <button className="btn-accent" onClick={create}>حفظ</button></div></div>
  <div className="card"><div className="flex gap-2 mb-3">
  <input className="input" placeholder="بحث بالاسم / الشركة" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} />
  <button className="btn" onClick={load}>بحث</button></div>
  <table><thead><tr><th>الاسم</th><th>الشركة</th><th>الهاتف</th><th>Aliases</th><th></th></tr></thead>
  <tbody>{rows.map((s:any)=><tr key={s.id}><td>{s.name}</td><td>{s.company_name||'-'}</td><td>{s.phone||'-'}</td><td className="text-xs">{(s.alias_names||[]).join(', ')}</td><td><button className="text-red-600 text-sm" onClick={()=>del(s.id)}>حذف</button></td></tr>)}
  {!rows.length && <tr><td colSpan={5} className="text-center text-gray-500 py-6">لا يوجد موردين</td></tr>}
  </tbody></table></div></div>)
}
