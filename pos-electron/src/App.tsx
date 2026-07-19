import React, { useEffect, useRef, useState } from 'react'
import { startSync } from './sync'
import { api } from './api'
// @ts-ignore
const bold = (window as any).bold

type CartItem = { variant_id: string, sku: string, name: string, qty: number, unit_price: number, unit_tax: number }

function LoginScreen({ onLogin }: { onLogin: (branchId: string) => void }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const session = await api.login(phone, password)
      onLogin(session.user.branch_id!)
    } catch (err: any) {
      setError(err.message || 'تعذر تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="pos" style={{display:'grid', placeItems:'center'}}>
      <form onSubmit={submit} style={{width:380, background:'#fff', borderRadius:16, padding:28, boxShadow:'0 12px 40px #0002'}}>
        <h1 style={{marginTop:0}}>Bold POS</h1>
        <p className="small">سجل الدخول بحساب الكاشير المرتبط بهذا الفرع.</p>
        <label>رقم الهاتف</label>
        <input className="barcode-input" style={{fontSize:18, margin:'6px 0 14px'}} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+201xxxxxxxxx" autoFocus />
        <label>كلمة المرور</label>
        <input className="barcode-input" style={{fontSize:18, margin:'6px 0 14px'}} type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {error && <div style={{color:'#b91c1c', marginBottom:12}}>{error}</div>}
        <button className="pay-btn accent" style={{width:'100%'}} disabled={loading}>{loading ? 'جارٍ الدخول…' : 'دخول'}</button>
      </form>
    </div>
  )
}

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [barcode, setBarcode] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerInfo, setCustomerInfo] = useState<any>(null)
  const [loyalty, setLoyalty] = useState<any>(null)
  const [authenticated, setAuthenticated] = useState(api.hasSession())
  const [branchId, setBranchId] = useState(authenticated ? localStorage.getItem('branch_id') || '' : '')
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const expired = () => { setAuthenticated(false); setBranchId('') }
    window.addEventListener('bold-auth-expired', expired)
    return () => window.removeEventListener('bold-auth-expired', expired)
  }, [])

  useEffect(()=>{
    if (!authenticated || !branchId) return
    barcodeRef.current?.focus()
    return startSync(branchId)
  }, [authenticated, branchId])

  // Customer loyalty lookup – debounced
  useEffect(() => {
    if (!authenticated || !customerPhone || customerPhone.length < 11) { setCustomerInfo(null); setLoyalty(null); return }
    const t = setTimeout(async () => {
      const c = await api.customerLookup(customerPhone).catch(()=>null)
      setCustomerInfo(c)
      const l = await api.customerLoyalty(customerPhone).catch(()=>({eligible:false}))
      setLoyalty(l)
    }, 400)
    return () => clearTimeout(t)
  }, [authenticated, customerPhone])

  const addByBarcode = async (code: string) => {
    if (!code) return
    const results = await bold.search(code)
    const p = results[0]
    if (!p) { alert('الصنف غير موجود'); return }
    // Pricing Engine – try live API first, then the version synced locally.
    let unit_price = 0
    let unit_tax = 0
    const priceResp = await api.pricing(p.id).catch(()=>null)
    if (priceResp?.net_price) {
      unit_price = Number(priceResp.net_price)
      unit_tax = Number(priceResp.tax_amount || 0)
    } else {
      unit_price = Number(p.selling_price || 0)
      unit_tax = Number(p.unit_tax || 0)
    }
    if (unit_price <= 0) {
      alert('لا يوجد سعر معتمد للصنف. اتصل بالإنترنت وحدّث البيانات قبل البيع.')
      return
    }
    setCart(c => {
      const found = c.find(i=>i.variant_id===p.id)
      if (found) return c.map(i=> i.variant_id===p.id ? {...i, qty: i.qty+1} : i)
      return [...c, { variant_id: p.id, sku: p.sku, name: p.name_en, qty:1, unit_price, unit_tax }]
    })
    setBarcode('')
    setTimeout(()=>barcodeRef.current?.focus(), 0)
  }

  const subtotal = cart.reduce((s,i)=> s + i.unit_price * i.qty, 0)
  const tax = Math.round(cart.reduce((sum, item) => sum + item.unit_tax * item.qty, 0) * 100) / 100
  const total = Math.round((subtotal + tax) * 100) / 100

  const doSale = async (payment_method: string) => {
    if (!cart.length) return
    if (!branchId) { alert('لا يوجد فرع مرتبط بالمستخدم'); return }
    const sync_id = crypto.randomUUID()
    const payload = {
      sync_id,
      branch_id: branchId,
      customer_phone: customerPhone || undefined,
      items: cart.map(i=>({ variant_id: i.variant_id, qty: i.qty })),
      payment_method,
      language: 'ar',
      // Used only by the local Electron database and stripped before sync.
      local_total: total
    }
    try {
      const res = await bold.sale(payload)
      await bold.print({ invoice_number: 'POS-'+Date.now(), total, items: cart }, 'ar')
      alert('تم البيع ✓  Sync: ' + res.sync_id)
      setCart([])
      barcodeRef.current?.focus()
    } catch (error: any) {
      alert('تعذر إتمام البيع: ' + (error.message || 'المخزون المحلي غير كافٍ'))
    }
  }

  const doReturn = async () => {
    const reference = prompt('أدخل رقم الفاتورة الأصلية أو UUID:')
    if (!reference) return
    try {
      const invoice = await api.invoiceLookup(reference.trim())
      const items: { sales_invoice_item_id: string, qty: number }[] = []
      for (const item of invoice.items || []) {
        if (item.returnable_qty <= 0) continue
        const name = item.variant?.product?.name_ar || item.variant?.product?.name_en || item.variant?.sku
        const answer = prompt(`${name}\nالمتاح للإرجاع: ${item.returnable_qty}\nالكمية المطلوبة:`, '0')
        const qty = Number(answer || 0)
        if (!Number.isInteger(qty) || qty < 0 || qty > item.returnable_qty) {
          throw new Error(`كمية غير صحيحة للصنف ${name}`)
        }
        if (qty > 0) items.push({ sales_invoice_item_id: item.id, qty })
      }
      if (!items.length) { alert('لم يتم اختيار أي كمية للإرجاع'); return }
      const reason = prompt('سبب الإرجاع (اختياري):') || undefined
      const result = await api.returnSale({ original_invoice_id: invoice.id, items, reason })
      alert(`تم تسجيل المرتجع ✓\nرقم المرتجع: ${result.return_invoice_number}\nقيمة الاسترداد: ${Number(result.refund_total)} ج`)
      await api.pull(branchId).then(data => bold.sync_apply_pull(data)).catch(() => undefined)
    } catch (error: any) {
      alert('تعذر تنفيذ المرتجع: ' + (error.message || 'يجب الاتصال بالخادم'))
    }
  }

  if (!authenticated || !branchId) {
    return <LoginScreen onLogin={(id) => { setBranchId(id); setAuthenticated(true) }} />
  }

  return (
    <div className="pos">
      <div className="left">
        <div style={{display:'flex', gap:12, alignItems:'center'}}>
          <h2 style={{margin:0}}>Bold POS – نقطة بيع</h2>
          <span className="badge">فرع: {branchId || 'غير محدد'}</span>
          <span className="small" style={{marginRight:'auto'}}>Offline-First</span>
          <button onClick={async()=>{ await api.logout(); setAuthenticated(false); setBranchId('') }}>خروج</button>
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
          <div><span>ضريبة القيمة المضافة</span><b>{tax} ج</b></div>
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
            onClick={doReturn}
          >إرجاع</button>
        </div>

        <div className="small" style={{lineHeight:1.5}}>
          🖨️ طباعة: عربي / English – 80mm thermal<br/>
          💵 الدرج: {localStorage.getItem('cash_drawer') || 'معطل'} – يفتح تلقائياً مع الطباعة<br/>
          📦 الأسعار غير شاملة الضريبة – تُضاف الضريبة المعتمدة عند الدفع<br/>
          🏷️ أسماء المنتجات بالإنجليزية
          {loyalty?.eligible && <div style={{color:'#065f46', fontWeight:'bold'}}>✓ خصم ولاء متاح لهذا العميل</div>}
        </div>
      </div>
    </div>
  )
}
