'use client'
import { useState } from 'react'
import { apiGet } from '@/lib/api'
export default function Inventory(){
  const [variant,setVariant] = useState('')
  const [rows,setRows] = useState<any[]>([])
  const lookup = async ()=> { const r = await apiGet(`/inventory/lookup?variant_id=${variant}`); setRows(r) }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">المخزون بين الفروع</h1>
      <div className="card flex gap-2">
        <input className="input" placeholder="Variant UUID" value={variant} onChange={e=>setVariant(e.target.value)} />
        <button className="btn" onClick={lookup}>بحث</button>
      </div>
      <div className="card">
        <table><thead><tr><th>الفرع</th><th>الكمية</th><th>محجوز</th></tr></thead>
        <tbody>{rows.map((s:any,i:number)=><tr key={i}><td>{s.branch?.name_ar}</td><td>{s.qty_on_hand}</td><td>{s.qty_reserved}</td></tr>)}</tbody>
        </table>
        {!rows.length && <div className="text-gray-500 py-4">ابحث برقم المتغير لمعرفة توفره في كل الفروع</div>}
      </div>
    </div>
  )
}
