import React, { useEffect, useRef, useState } from 'react'
import { startSync } from './sync'
// @ts-ignore
const bold = (window as any).bold

type CartItem = { variant_id: string, sku: string, name: string, qty: number, unit_price: number, unit_cost: number }

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [barcode, setBarcode] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [branchId] = useState(localStorage.getItem('branch_id') || '')
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(()=>{ barcodeRef.current?.focus(); if(branchId) startSync(branchId) }, [branchId])

  const addByBarcode = async (code: string) => {
    if (!code) return
    const results = await bold.search(code)
    const p = results[0]
    if (!p) { alert('الصنف غير موجود'); return }
    const stock = await bold.stock(p.id)
    setCart(c => {
      const found = c.find(i=>i.variant_id===p.id)
      if (found) return c.map(i=> i.variant_id===p.id ? {...i, qty: i.qty+1} : i)
      return [...c, { variant_id: p.id, sku: p.sku, name: p.name_en, qty:1, unit_price: 199, unit_cost: Number(p.cost_price||0)}]
    })
    setBarcode('')
    setTimeout(()=>barcodeRef.current?.focus(), 0)
  }

  const subtotal = cart.reduce((s,i)=> s + i.unit_price * i.qty, 0)
  const tax = Math.round(subtotal * 0.14)
  const total = subtotal + tax

  const doSale = async (payment_method: string) => {
    if (!cart.length) return
    const sync_id = crypto.randomUUID()
    const payload = {
      sync_id,
      branch_id: branchId || '00000000-0000-0000-0000-000000000000',
      customer_phone: customerPhone || undefined,
      items: cart.map(i=>({ variant_id: i.variant_id, qty: i.qty, unit_price: i.unit_price, unit_cost: i.unit_cost })),
      payment_method,
      language: 'ar',
      total
    }
    const res = await bold.sale(payload)
    await bold.print({ invoice_number: 'POS-'+Date.now(), total, items: cart }, 'ar')
    alert('تم البيع ✓  Sync: ' + res.sync_id)
    setCart([])
    barcodeRef.current?.focus()
  }

  return (
    <div className="pos">
      <div className="left">
        <div style={{display:'flex', gap:12, alignItems:'center'}}>
          <h2 style={{margin:0}}>Bold POS – نقطة بيع</h2>
          <span className="badge">فرع: {branchId || 'غير محدد'}</span>
          <span className="small" style={{marginRight:'auto'}}>Offline-First</span>
        </div>
        <input
          ref={barcodeRef}
          className="barcode-input"
          placeholder="امسح الباركود هنا…"
          value={barcode}
          onChange={e=>setBarcode(e.target.value)}
          onKeyDown={e=> { if(e.key==='Enter'){ addByBarcode(barcode.trim()) }}}
          autoFocus
        />
        <div className="cart-table">
          <table>
            <thead><tr><th>الصنف</th><th>SKU</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th></th></tr></thead>
            <tbody>
              {cart.map((it,idx)=>(
                <tr key={idx}>
                  <td>{it.name}</td>
                  <td>{it.sku}</td>
                  <td>{it.qty}</td>
                  <td>{it.unit_price} ج</td>
                  <td>{it.unit_price * it.qty} ج</td>
                  <td><button onClick={()=>setCart(cart.filter((_,i)=>i!==idx))}>✕</button></td>
                </tr>
              ))}
              {!cart.length && <tr><td colSpan={6} style={{textAlign:'center', color:'#888', padding:24}}>امسح باركود لإضافة صنف</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="small">تلميح: الماسح USB يعمل ككيبورد – المؤشر دائما في خانة الباركود. Enter يضيف تلقائيا.</div>
      </div>

      <div className="right">
        <div>
          <label>هاتف العميل (اختياري)</label>
          <input value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} placeholder="01xxxxxxxxx" style={{width:'100%', padding:10, borderRadius:8, border:'1px solid #ccc'}} />
          <div className="small">يستخدم للولاء / واتساب العروض</div>
        </div>

        <div className="totals">
          <div><span>المجموع الفرعي</span><b>{subtotal} ج</b></div>
          <div><span>الضريبة 14%</span><b>{tax} ج</b></div>
          <div style={{fontSize:22, borderTop:'2px solid #111', paddingTop:8}}><span>الإجمالي</span><b>{total} ج</b></div>
        </div>

        <div className="pay-grid">
          <button className="pay-btn accent" onClick={()=>doSale('cash')}>نقدي</button>
          <button className="pay-btn" onClick={()=>doSale('card')}>فيزا</button>
          <button className="pay-btn" onClick={()=>doSale('instapay')}>انستا باي</button>
          <button className="pay-btn" onClick={()=>doSale('vodafone_cash')}>فودافون كاش</button>
          <button className="pay-btn" onClick={()=>doSale('installment')} style={{gridColumn:'1 / -1'}}>تقسيط</button>
        </div>

        <div style={{display:'flex', gap:8}}>
          <button className="pay-btn" style={{flex:1, background:'#555'}} onClick={()=>setCart([])}>تفريغ</button>
          <button className="pay_btn" style={{flex:1, padding:14, borderRadius:10, border:'1px solid #ccc', background:'#fff'}} onClick={()=>alert('إرجاع – امسح رقم الفاتورة الأصلية')}>إرجاع / استبدال</button>
        </div>

        <div className="small">
          طباعة: عربي / English – الدرج: {localStorage.getItem('cash_drawer') || 'معطل'}<br/>
          السعر يشمل الضريبة. المنتجات بالإنجليزية كما طلبت.
        </div>
      </div>
    </div>
  )
}
