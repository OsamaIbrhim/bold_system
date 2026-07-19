'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, getStoredUser } from '@/lib/api'

type SalesResponse = { items:any[]; page:number; page_size:number; total:number; total_pages:number; server_time:string }

export default function Sales(){
  const [data,setData]=useState<SalesResponse>({items:[],page:1,page_size:20,total:0,total_pages:1,server_time:''})
  const [page,setPage]=useState(1), [q,setQ]=useState(''), [query,setQuery]=useState('')
  const [from,setFrom]=useState(''), [to,setTo]=useState(''), [payment,setPayment]=useState(''), [branch,setBranch]=useState('')
  const [branches,setBranches]=useState<any[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState('')
  const owner = getStoredUser()?.role === 'owner'
  const load=useCallback(async()=>{
    setLoading(true); setError('')
    const params=new URLSearchParams({page:String(page),page_size:'20'})
    if(query)params.set('q',query); if(from)params.set('from',from); if(to)params.set('to',to); if(payment)params.set('payment_method',payment); if(branch)params.set('branch_id',branch)
    try{setData(await apiGet(`/sales?${params}`))}catch(e:any){setError(e.message||'تعذر تحميل الفواتير')}finally{setLoading(false)}
  },[page,query,from,to,payment,branch])
  useEffect(()=>{load(); const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},30000); return()=>clearInterval(timer)},[load])
  useEffect(()=>{if(owner)apiGet('/branches').then(setBranches).catch(()=>undefined)},[owner])
  const apply=(e:React.FormEvent)=>{e.preventDefault();setPage(1);setQuery(q.trim())}
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-2xl font-bold">فواتير المبيعات والمرتجعات</h1><p className="text-sm text-gray-500">تحديث تلقائي كل 30 ثانية من قاعدة البيانات المركزية</p></div><button className="btn-secondary" onClick={load} disabled={loading}>تحديث الآن</button></div>
    <form className="card grid grid-cols-1 md:grid-cols-6 gap-2" onSubmit={apply}>
      <input className="input md:col-span-2" placeholder="رقم الفاتورة / العميل / الهاتف" value={q} onChange={e=>setQ(e.target.value)}/>
      <input className="input" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}}/><input className="input" type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}}/>
      <select className="select" value={payment} onChange={e=>{setPayment(e.target.value);setPage(1)}}><option value="">كل طرق الدفع</option><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="instapay">InstaPay</option><option value="vodafone_cash">Vodafone Cash</option><option value="installment">تقسيط</option></select>
      <button className="btn">بحث</button>
      {owner&&<select className="select md:col-span-2" value={branch} onChange={e=>{setBranch(e.target.value);setPage(1)}}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name_ar} ({b.code})</option>)}</select>}
    </form>
    <div className="card overflow-auto">
      <div className="flex justify-between text-sm text-gray-500 mb-3"><span>{data.total} فاتورة</span><span>{data.server_time&&`آخر قراءة: ${new Date(data.server_time).toLocaleTimeString('ar-EG')}`}</span></div>
      {error&&<div className="text-red-700 py-4">{error} <button className="underline" onClick={load}>إعادة المحاولة</button></div>}
      <table><thead><tr><th>رقم الفاتورة</th><th>الفرع</th><th>نقطة البيع</th><th>العميل</th><th>الدفع</th><th>الإجمالي</th><th>الأصناف</th><th>المرتجعات</th><th>التاريخ</th></tr></thead><tbody>
        {data.items.map(i=><tr key={i.id}><td><Link className="text-blue-700 underline" href={`/sales/${i.id}`}>{i.invoice_number}</Link></td><td>{i.branch?.name_ar||i.branch?.code}</td><td>{i.terminal?.name||i.terminal?.terminal_code||'—'}</td><td>{i.customer?.name||i.customer?.phone||'نقدي'}</td><td>{i.payment_method}</td><td className="font-bold">{Number(i.total).toFixed(2)} ج</td><td>{i._count?.items||0}</td><td>{i._count?.original_returns||0}</td><td>{new Date(i.created_at).toLocaleString('ar-EG')}</td></tr>)}
        {loading&&<tr><td colSpan={9} className="text-center text-gray-500 py-8">جارٍ تحميل الفواتير…</td></tr>}{!loading&&!data.items.length&&<tr><td colSpan={9} className="text-center text-gray-500 py-8">لا توجد فواتير مطابقة</td></tr>}
      </tbody></table>
      <div className="flex items-center justify-center gap-3 mt-4"><button className="btn-secondary" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {data.page} من {data.total_pages}</span><button className="btn-secondary" disabled={page>=data.total_pages||loading} onClick={()=>setPage(p=>p+1)}>التالي</button></div>
    </div>
  </div>
}
