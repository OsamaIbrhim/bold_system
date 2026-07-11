'use client'
import { useState } from 'react'
import { apiPost } from '@/lib/api'
export default function Pricing(){
  const [variant,setVariant] = useState('')
  const [res,setRes] = useState<any>(null)
  const calc = async ()=> { const r = await apiPost('/pricing/calculate', { variant_id: variant }); setRes(r) }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">محرك التسعير</h1>
      <div className="card">
        <div className="flex gap-2 mb-3">
          <input className="input" placeholder="Variant UUID" value={variant} onChange={e=>setVariant(e.target.value)} />
          <button className="btn" onClick={calc}>احسب</button>
        </div>
        {res && <div className="space-y-1 text-sm">
          <div>التكلفة: {res.cost} ج</div>
          <div>Overhead: {res.overhead_percent}% – Profit: {res.profit_percent}% – Tax: {res.tax_percent}%</div>
          <div className="text-lg font-bold">سعر البيع: {res.selling_price} ج</div>
          <div className="text-amber-700">الحد الأدنى المسموح: {res.min_allowed_price} ج (تكلفة + Overhead محمي)</div>
        </div>}
      </div>
      <div className="card text-sm text-gray-600">صيغة مركبة قابلة للتعديل. قواعد: Global → Category → Brand → Product → Variant. تجاوز يدوي = Admin فقط مع audit log.</div>
    </div>
  )
}
