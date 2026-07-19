'use client'
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

export default function Branches(){
  const [items,setItems]=useState<any[]>([]), [error,setError]=useState('')
  const [code,setCode]=useState(''), [nameAr,setNameAr]=useState(''), [nameEn,setNameEn]=useState(''), [address,setAddress]=useState(''), [phone,setPhone]=useState('')
  const load=()=>apiGet('/branches').then(setItems).catch((e:any)=>setError(e.message))
  useEffect(()=>{ load() },[])
  const create=async()=>{try{await apiPost('/branches',{code,name_ar:nameAr,name_en:nameEn||undefined,address:address||undefined,phone:phone||undefined});setCode('');setNameAr('');setNameEn('');setAddress('');setPhone('');load()}catch(e:any){setError(e.message)}}
  return <div className="space-y-4"><h1 className="text-2xl font-bold">الفروع</h1><div className="card"><h2 className="font-bold mb-3">إضافة فرع</h2><div className="grid grid-cols-1 md:grid-cols-5 gap-2"><input className="input" placeholder="الكود *" value={code} onChange={e=>setCode(e.target.value)}/><input className="input" placeholder="الاسم العربي *" value={nameAr} onChange={e=>setNameAr(e.target.value)}/><input className="input" placeholder="English name" value={nameEn} onChange={e=>setNameEn(e.target.value)}/><input className="input" placeholder="العنوان" value={address} onChange={e=>setAddress(e.target.value)}/><input className="input" placeholder="الهاتف" value={phone} onChange={e=>setPhone(e.target.value)}/></div><button className="btn-accent mt-3" disabled={!code||!nameAr} onClick={create}>إنشاء الفرع</button>{error&&<div className="text-red-700 mt-2">{error}</div>}</div>
    <div className="card overflow-auto"><table><thead><tr><th>الكود</th><th>الاسم</th><th>العنوان</th><th>الهاتف</th><th>درج النقد</th><th>الحالة</th></tr></thead><tbody>{items.map(b=><tr key={b.id}><td>{b.code}</td><td>{b.name_ar}<div className="text-xs text-gray-500">{b.name_en}</div></td><td>{b.address||'—'}</td><td>{b.phone||'—'}</td><td>{b.cash_drawer_enabled?'مفعل':'معطل'}</td><td>{b.is_active?'نشط':'غير نشط'}</td></tr>)}{!items.length&&<tr><td colSpan={6} className="text-center py-8 text-gray-500">لا توجد فروع</td></tr>}</tbody></table></div></div>
}
