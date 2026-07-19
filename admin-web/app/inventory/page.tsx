'use client'
import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
export default function Inventory(){
  const [variant,setVariant]=useState(''),[products,setProducts]=useState<any[]>([]),[rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('')
  useEffect(()=>{apiGet('/products?page=1&page_size=100').then(r=>setProducts(r.items||[])).catch((e:any)=>setError(e.message))},[])
  const lookup=async()=>{if(!variant)return;setLoading(true);try{setRows(await apiGet(`/inventory/lookup?variant_id=${variant}`));setError('')}catch(e:any){setError(e.message)}finally{setLoading(false)}}
  return <div className="space-y-4"><h1 className="text-2xl font-bold">المخزون بين الفروع</h1><div className="card flex gap-2"><select className="select" value={variant} onChange={e=>setVariant(e.target.value)}><option value="">اختر المنتج / SKU</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} – {p.product?.name_ar||p.product?.name_en} {p.size||''} {p.color||''}</option>)}</select><button className="btn" disabled={!variant||loading} onClick={lookup}>عرض المخزون</button></div>{error&&<div className="card text-red-700">{error}</div>}<div className="card"><table><thead><tr><th>الفرع</th><th>الكمية</th><th>محجوز</th><th>المتاح</th><th>آخر بيع</th></tr></thead><tbody>{rows.map((s:any)=><tr key={`${s.branch_id}-${s.variant_id}`}><td>{s.branch?.name_ar}</td><td>{s.qty_on_hand}</td><td>{s.qty_reserved}</td><td>{s.qty_on_hand-s.qty_reserved}</td><td>{s.last_sold_at?new Date(s.last_sold_at).toLocaleString('ar-EG'):'—'}</td></tr>)}{!loading&&!rows.length&&<tr><td colSpan={5} className="text-center text-gray-500 py-8">اختر منتجاً لعرض مخزونه</td></tr>}</tbody></table></div></div>
}
