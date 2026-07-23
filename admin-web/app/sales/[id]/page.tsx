'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiGet, apiGetBlob } from '@/lib/api'
import { formatMoney, lineTotal } from '@/lib/money'

export default function InvoiceDetails(){
  const {id}=useParams<{id:string}>(); const [invoice,setInvoice]=useState<any>(null), [error,setError]=useState('')
  useEffect(()=>{apiGet(`/sales/${id}`).then(setInvoice).catch((e:any)=>setError(e.message))},[id])
  const pdf=async(lang:'ar'|'en')=>{try{const blob=await apiGetBlob(`/sales/${id}/pdf?lang=${lang}`);const url=URL.createObjectURL(blob);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e:any){alert(e.message)}}
  if(error)return <div className="card text-red-700">تعذر تحميل الفاتورة: {error}</div>
  if(!invoice)return <div className="card">جارٍ تحميل الفاتورة…</div>
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><Link href="/sales" className="text-blue-700">← العودة للفواتير</Link><h1 className="text-2xl font-bold mt-2">فاتورة {invoice.invoice_number}</h1></div><div className="flex gap-2"><button className="btn" onClick={()=>pdf('ar')}>PDF عربي</button><button className="btn-secondary" onClick={()=>pdf('en')}>PDF English</button></div></div>
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3"><div className="card"><div className="text-gray-500 text-sm">الفرع</div><b>{invoice.branch?.name_ar}</b></div><div className="card"><div className="text-gray-500 text-sm">نقطة البيع</div><b>{invoice.terminal?.name||invoice.terminal?.terminal_code||'—'}</b></div><div className="card"><div className="text-gray-500 text-sm">الكاشير الأصلي</div><b>{invoice.cashier?.name||'—'}</b></div><div className="card"><div className="text-gray-500 text-sm">العميل</div><b>{invoice.customer?.name||invoice.customer?.phone||'نقدي'}</b></div><div className="card"><div className="text-gray-500 text-sm">الدفع</div><b>{invoice.payment_method}</b></div><div className="card"><div className="text-gray-500 text-sm">وقت البيع</div><b>{new Date(invoice.occurred_at||invoice.created_at).toLocaleString('ar-EG')}</b></div></div>
    <div className="card text-sm text-gray-600 grid grid-cols-1 md:grid-cols-3 gap-2"><div><span>الوردية: </span><b>{invoice.shift_id||'—'}</b></div><div><span>ترتيب الجهاز: </span><b>{invoice.terminal_sequence?.toString()||'—'}</b></div><div><span>وقت الاستلام بالخادم: </span><b>{new Date(invoice.received_at||invoice.created_at).toLocaleString('ar-EG')}</b></div>{invoice.receiver?.name&&invoice.receiver.id!==invoice.cashier?.id&&<div className="md:col-span-3"><span>تم رفع العملية بواسطة: </span><b>{invoice.receiver.name}</b></div>}</div>
    <div className="card overflow-auto"><table><thead><tr><th>SKU</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الضريبة</th><th>الإجمالي</th><th>مرتجع</th></tr></thead><tbody>{invoice.items.map((i:any)=><tr key={i.id}><td>{i.variant?.sku}</td><td>{i.variant?.product?.name_ar||i.variant?.product?.name_en}</td><td>{i.qty}</td><td>{formatMoney(i.unit_price)}</td><td>{formatMoney(i.unit_tax)}</td><td>{lineTotal(i.unit_price,i.unit_tax,i.qty)} ج</td><td>{(i.return_items||[]).reduce((s:number,r:any)=>s+r.qty,0)}</td></tr>)}</tbody></table>
      <div className="mt-4 mr-auto max-w-sm space-y-1"><div className="flex justify-between"><span>المجموع</span><b>{formatMoney(invoice.subtotal)} ج</b></div><div className="flex justify-between"><span>الضريبة</span><b>{formatMoney(invoice.tax_amount)} ج</b></div><div className="flex justify-between text-xl border-t pt-2"><span>الإجمالي</span><b>{formatMoney(invoice.total)} ج</b></div></div>
    </div>
    <div className="card"><h2 className="font-bold mb-2">المرتجعات</h2>{invoice.original_returns?.length?invoice.original_returns.map((r:any)=><div key={r.id} className="border-b py-2 flex justify-between"><span>{r.return_invoice_number} – {new Date(r.created_at).toLocaleString('ar-EG')}</span><b>{formatMoney(r.refund_total)} ج</b></div>):<div className="text-gray-500">لا توجد مرتجعات لهذه الفاتورة</div>}</div>
  </div>
}
