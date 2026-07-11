import React, { useEffect, useRef, useState } from 'react'
import { startSync } from './sync'
import { api, calcPriceLocal } from './api'
// @ts-ignore
const bold = (window as any).bold

type CartItem = { variant_id: string, sku: string, name: string, qty: number, unit_price: number, unit_cost: number }

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [barcode, setBarcode] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerInfo, setCustomerInfo] = useState<any>(null)
  const [loyalty, setLoyalty] = useState<any>(null)
  const [branchId] = useState(localStorage.getItem('branch_id') || '')
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(()=>{ barcodeRef.current?.focus(); if(branchId) startSync(branchId) }, [branchId])

  // Customer loyalty lookup – debounced
  useEffect(() => {
    if (!customerPhone || customerPhone.length < 11) { setCustomerInfo(null); setLoyalty(null); return }
    const t = setTimeout(async () => {
      const c = await api.customerLookup(customerPhone).catch(()=>null)
      setCustomerInfo(c)
      const l = await api.customerLoyalty(customerPhone).catch(()=>({eligible:false}))
      setLoyalty(l)
    }, 400)
    return () => clearTimeout(t)
  }, [customerPhone])

  const addByBarcode = async (code: string) => {
    if (!code) return
    const results = await bold.search(code)
    const p = results[0]
    if (!p) { alert('الصنف غير موجود'); return }
    const cost = Number(p.cost_price || 0)
    // Pricing Engine – try live API first, fallback to local compound
    let unit_price = 0
    let price_source = 'local'
    const priceResp = await api.pricing(p.id).catch(()=>null)
    if (priceResp?.selling_price) {
      // API returns tax-inclusive – convert to net for POS totals
      const taxPct = Number(priceResp.tax_percent || 14)
      unit_price = Math.round(Number(priceResp.selling_price) / (1 + taxPct/100))
      price_source = 'api'
    } else {
      // Fallback offline: Overhead 20%, Profit 35%, Tax excluded (added at total)
      unit_price = calcPriceLocal(cost, 20, 35, 0)
    }
    setCart(c => {
      const found = c.find(i=>i.variant_id===p.id)
      if (found) return c.map(i=> i.variant_id===p.id ? {...i, qty: i.qty+1} : i)
      return [...c, { variant_id: p.id, sku: p.sku, name: p.name_en, qty:1, unit_price, unit_cost: cost }]
    })
    // @ts-ignore – show price source briefly
    if (price_source === 'local') console.log('Price offline – using local formula')
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
          {!customerPhone && <div className="small">يستخدم للولاء / واتساب العروض</div>}
          {customerPhone && customerInfo && (
            <div className="small" style={{marginTop:4, padding:'6px 8px', background:'#f3f4f6', borderRadius:6}}>
              {customerInfo.name || 'عميل'} – فواتير: {customerInfo.total_invoices || 0} – إجمالي: {Number(customerInfo.total_spent||0)} ج
              {customerInfo.is_vip && <span style={{color:'#f59e0b', fontWeight:'bold'}}> – VIP ⭐</span>}
            </div>
          )}
          {loyalty?.eligible && (
            <div className="small" style={{marginTop:4, padding:'6px 8px', background:'#ecfdf5', color:'#065f46', borderRadius:6, fontWeight:'bold'}}>
              ✓ عميل مميز – يحق له خصم ولاء
            </div>
          )}
          {customerPhone && customerPhone.length >= 11 && !customerInfo && (
            <div className="small" style={{color:'#888'}}>عميل جديد – سيتم إنشاؤه مع أول فاتورة</div>
          )}
        </div>

        <div className="totals">
          <div><span>المجموع الفرعي (غير شامل الضريبة)</span><b>{subtotal} ج</b></div>
          <div><span>ضريبة القيمة المضافة 14%</span><b>{tax} ج</b></div>
          <div style={{fontSize:22, borderTop:'2px solid #111', paddingTop:8}}><span>الإجمالي شامل الضريبة</span><b>{total} ج</b></div>
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
          <button 
            style={{flex:1, padding:14, borderRadius:10, border:'1px solid #ccc', background:'#fff', cursor:'pointer'}}
            onClick={async ()=>{
              const inv = prompt('إرجاع / استبدال\nأدخل رقم الفاتورة الأصلية أو امسح الباركود:')
              if(!inv) return
              alert(`سيتم فتح الفاتورة: ${inv}\n\nفي الشاشة الكاملة:\n1. اختر الأصناف المرتجعة\n2. إنشاء فاتورة مرتجع مرتبطة بالأصل\n3. منع الاحتيال – النظام يعرض تاريخ الإرجاع السابق\n\nAPI: POST /pos/return\n{ "original_invoice_id": "...", "items": [...] }\n\nحالياً في نسخة Admin Web: /sales`)
            }}
          >إرجاع / استبدال</button>
        </div>

        <div className="small" style={{lineHeight:1.5}}>
          🖨️ طباعة: عربي / English – 80mm thermal<br/>
          💵 الدرج: {localStorage.getItem('cash_drawer') || 'معطل'} – يفتح تلقائياً مع الطباعة<br/>
          📦 الأسعار غير شاملة الضريبة – تضاف 14% عند الدفع<br/>
          🏷️ أسماء المنتجات بالإنجليزية
          {loyalty?.eligible && <div style={{color:'#065f46', fontWeight:'bold'}}>✓ خصم ولاء متاح لهذا العميل</div>}
        </div>
      </div>
    </div>
  )
}
