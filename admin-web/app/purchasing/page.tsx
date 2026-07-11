'use client'
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
export default function Purchasing(){
  const [invoices,setInvoices]=useState<any[]>([])
  const [suppliers,setSuppliers]=useState<any[]>([])
  const [supplierId,setSupplierId]=useState('')
  const [branchId,setBranchId]=useState('')
  const load = async()=>{ const r = await apiGet('/purchasing/invoices'); setInvoices(r||[]) }
  const loadSuppliers = async()=>{ const r = await apiGet('/suppliers'); setSuppliers(r||[]) }
  useEffect(()=>{ load(); loadSuppliers() },[])
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">المشتريات</h1>
  <div className="card"><h2 className="font-bold mb-2">استلام بضاعة – سريع</h2>
  <div className="text-sm text-gray-600">استخدم شاشة الـ POS / Warehouse لاستلام البضاعة بالباركود – API: POST /purchasing/receive<br/>الموردين المتاحين: {suppliers.map((s:any)=>s.name).join(', ')}</div>
  </div>
  <div className="card"><h2 className="font-bold mb-2">فواتير المشتريات</h2>
  <table><thead><tr><th>الرقم</th><th>المورد</th><th>الإجمالي</th><th>التاريخ</th></tr></thead>
  <tbody>{invoices.map((p:any)=><tr key={p.id}><td>{p.invoice_number||p.id.slice(0,8)}</td><td>{p.supplier?.name}</td><td>{Number(p.total)} ج</td><td>{new Date(p.created_at).toLocaleDateString('ar-EG')}</td></tr>)}
  {!invoices.length && <tr><td colSpan={4} className="text-center text-gray-500 py-4">لا توجد فواتير</td></tr>}
  </tbody></table></div></div>)
}
