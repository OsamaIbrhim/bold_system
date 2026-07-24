'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost, getStoredUser } from '@/lib/api'
import { hasCapability } from '@/lib/permissions'

type ProductResponse = { items:any[]; page:number; page_size:number; total:number; total_pages:number; suggestions?:{value:string;label:string}[] }

export default function ProductsPage(){
  const canManage = hasCapability(getStoredUser(), 'products.manage')
  const [query,setQuery] = useState('')
  const [appliedQuery,setAppliedQuery] = useState('')
  const [page,setPage] = useState(1)
  const [data,setData] = useState<ProductResponse>({items:[],page:1,page_size:20,total:0,total_pages:1})
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')

  const load = useCallback(async()=>{
    setLoading(true); setError('')
    try { setData(await apiGet(`/products?q=${encodeURIComponent(appliedQuery)}&page=${page}&page_size=20`)) }
    catch(e:any){ setError(e.message || 'تعذر تحميل المنتجات') }
    finally { setLoading(false) }
  },[appliedQuery,page])
  useEffect(()=>{ load() },[load])

  const [name_en,setName] = useState(''), [sku,setSku] = useState('')
  const [barcode_ean,setEan] = useState(''), [barcode_int,setInt] = useState('')
  const [size,setSize] = useState(''), [color,setColor] = useState(''), [cost,setCost] = useState('')
  const [msg,setMsg] = useState('')

  const create = async()=>{
    try {
      const result = await apiPost('/products',{name_en,sku,barcode_ean13:barcode_ean||undefined,barcode_internal:barcode_int||undefined,size:size||undefined,color:color||undefined,cost_price:Number(cost)||0})
      setMsg('تم الحفظ ✓ '+(result.variants?.[0]?.sku || sku)); setName(''); setSku(''); setEan(''); setInt(''); setSize(''); setColor(''); setCost(''); setPage(1); load()
    } catch(e:any){ setMsg('خطأ: '+e.message) }
  }
  const del = async(id:string)=>{ if(!confirm('حذف الصنف؟')) return; try{ await apiDelete(`/products/variants/${id}`); load() }catch(e:any){ alert('فشل الحذف: '+e.message) } }
  const search = ()=>{ setPage(1); setAppliedQuery(query.trim()) }

  return <div className="space-y-4">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">المنتجات / المتغيرات</h1><span className="text-sm text-gray-500">{data.total} منتج</span></div>
    {canManage && <div className="card"><h2 className="font-bold mb-2">إضافة منتج سريع</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <input className="input" placeholder="Name EN*" value={name_en} onChange={e=>setName(e.target.value)}/><input className="input" placeholder="SKU*" value={sku} onChange={e=>setSku(e.target.value)}/>
      <input className="input" placeholder="EAN-13 مورد" value={barcode_ean} onChange={e=>setEan(e.target.value)}/><input className="input" placeholder="باركود داخلي Bold" value={barcode_int} onChange={e=>setInt(e.target.value)}/>
      <input className="input" placeholder="المقاس" value={size} onChange={e=>setSize(e.target.value)}/><input className="input" placeholder="اللون" value={color} onChange={e=>setColor(e.target.value)}/>
      <input className="input" placeholder="سعر التكلفة EGP" value={cost} onChange={e=>setCost(e.target.value)}/><button className="btn-accent" onClick={create} disabled={!name_en||!sku}>حفظ</button>
    </div><div className="text-xs text-gray-500 mt-2">{msg || 'الاسم بالإنجليزية – الصورة اختيارية – يدعم Simple و Variant'}</div></div>}
    <div className="card"><form className="flex gap-2" onSubmit={e=>{e.preventDefault();search()}}><input className="input" placeholder="ابحث بالباركود / SKU / الاسم، أو اتركه فارغاً لعرض الكل" value={query} onChange={e=>setQuery(e.target.value)}/><button className="btn">بحث</button><button type="button" className="btn-secondary" onClick={()=>{setQuery('');setAppliedQuery('');setPage(1)}}>الكل</button></form></div>
    <div className="card overflow-auto">
      {error && <div className="text-red-700 py-4">{error} <button className="underline" onClick={load}>إعادة المحاولة</button></div>}
      <table><thead><tr><th>SKU</th><th>الاسم</th><th>المقاس</th><th>اللون</th><th>EAN-13</th><th>داخلي</th><th>التكلفة</th><th>المخزون</th><th></th></tr></thead><tbody>
        {data.items.map(r=><tr key={r.id}><td>{r.sku}</td><td>{r.product?.name_ar||r.product?.name_en}</td><td>{r.size||'-'}</td><td>{r.color||'-'}</td><td>{r.barcode_ean13||'-'}</td><td>{r.barcode_internal||'-'}</td><td>{r.cost_price!==undefined?`${Number(r.cost_price)} ج`:'—'}</td><td>{(r.stock_by_branch||[]).reduce((s:number,x:any)=>s+x.qty_on_hand,0)}</td><td>{canManage&&<button className="text-red-600 text-sm" onClick={()=>del(r.id)}>حذف</button>}</td></tr>)}
        {!loading&&!data.items.length&&<tr><td colSpan={9} className="text-center text-gray-500 py-8"><div>لا توجد منتجات مطابقة. راجع الاسم أو SKU أو الباركود.</div>{!!data.suggestions?.length&&<div className="mt-3">هل تقصد: {data.suggestions.map(item=><button key={item.value} className="text-blue-700 underline mx-1" onClick={()=>{setQuery(item.value);setAppliedQuery(item.value);setPage(1)}}>{item.label}</button>)}</div>}</td></tr>}
        {loading&&<tr><td colSpan={9} className="text-center text-gray-500 py-8">جارٍ تحميل المنتجات…</td></tr>}
      </tbody></table>
      <div className="flex items-center justify-center gap-3 mt-4"><button className="btn-secondary" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {data.page} من {data.total_pages}</span><button className="btn-secondary" disabled={page>=data.total_pages||loading} onClick={()=>setPage(p=>p+1)}>التالي</button></div>
    </div>
  </div>
}
