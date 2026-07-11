'use client'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

export default function ProductsPage(){
  const [q,setQ] = useState('')
  const [rows,setRows] = useState<any[]>([])
  const search = async () => { const r = await apiGet(`/products/search?q=${encodeURIComponent(q)}`); setRows(r) }

  // create form
  const [name_en,setName] = useState('')
  const [sku,setSku] = useState('')
  const [barcode_ean,setEan] = useState('')
  const [barcode_int,setInt] = useState('')
  const [size,setSize] = useState('')
  const [color,setColor] = useState('')
  const [cost,setCost] = useState('')
  const [msg,setMsg] = useState('')

  const create = async () => {
    try {
      const r = await apiPost('/products', {
        name_en, sku,
        barcode_ean13: barcode_ean || undefined,
        barcode_internal: barcode_int || undefined,
        size: size || undefined,
        color: color || undefined,
        cost_price: Number(cost)||0
      })
      setMsg('تم الحفظ ✓ ID: ' + r.id)
      setName(''); setSku(''); setEan(''); setInt(''); setSize(''); setColor(''); setCost('');
      setQ(sku); search()
    } catch(e:any){ setMsg('خطأ: ' + e.message) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">المنتجات / المتغيرات</h1>
      
      <div className="card">
        <h2 className="font-bold mb-2">إضافة منتج سريع</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className="input" placeholder="Name EN*" value={name_en} onChange={e=>setName(e.target.value)} />
          <input className="input" placeholder="SKU*" value={sku} onChange={e=>setSku(e.target.value)} />
          <input className="input" placeholder="EAN-13 مورد" value={barcode_ean} onChange={e=>setEan(e.target.value)} />
          <input className="input" placeholder="باركود داخلي Bold" value={barcode_int} onChange={e=>setInt(e.target.value)} />
          <input className="input" placeholder="المقاس" value={size} onChange={e=>setSize(e.target.value)} />
          <input className="input" placeholder="اللون" value={color} onChange={e=>setColor(e.target.value)} />
          <input className="input" placeholder="سعر التكلفة EGP" value={cost} onChange={e=>setCost(e.target.value)} />
          <button className="btn-accent" onClick={create}>حفظ</button>
        </div>
        <div className="text-xs text-gray-500 mt-2">{msg || 'الاسم بالإنجليزية – الصورة اختيارية – يدعم Simple و Variant'}</div>
      </div>

      <div className="card">
        <div className="flex gap-2">
          <input className="input" placeholder="ابحث بالباركود / SKU / الاسم" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} />
          <button className="btn" onClick={search}>بحث</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table>
          <thead><tr><th>SKU</th><th>الاسم EN</th><th>المقاس</th><th>اللون</th><th>EAN-13</th><th>داخلي</th><th>التكلفة</th><th>مرتجعات</th></tr></thead>
          <tbody>
            {rows.map((r:any)=>(
              <tr key={r.id}><td>{r.sku}</td><td>{r.product?.name_en}</td><td>{r.size||'-'}</td><td>{r.color||'-'}</td><td>{r.barcode_ean13||'-'}</td><td>{r.barcode_internal||'-'}</td><td>{Number(r.cost_price)} ج</td><td>{r.return_count}</td></tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="text-center text-gray-500 py-6">ابحث لعرض النتائج</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
