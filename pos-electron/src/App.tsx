import React, { useEffect, useRef, useState } from 'react'
import { startSync, syncLoop, SyncState } from './sync'
import { api, ApiError } from './api'
// @ts-ignore
const bold = (window as any).bold

type CartItem = { variant_id: string, sku: string, name: string, qty: number, unit_price: number, unit_tax: number }
const toCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100)
const fromCents = (value: number) => value / 100

function EnrollmentScreen({ onEnrolled }: { onEnrolled: (branchId: string, terminalCode: string) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (code.trim().length !== 12) { setError('رمز التسجيل يتكون من 12 حرفاً. أنشئ رمزاً جديداً من لوحة الإدارة.'); return }
    setLoading(true)
    try {
      const terminal = await bold.sync_get_status()
      const enrolled = await api.enroll(code, terminal)
      onEnrolled(enrolled.branch_id, enrolled.terminal_code)
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : 'تعذر تسجيل الجهاز'
      setError(`${message}${err?.requestId ? ` — المرجع: ${err.requestId}` : ''}`)
    } finally { setLoading(false) }
  }
  return <div className="pos" style={{display:'grid',placeItems:'center'}}>
    <form onSubmit={submit} style={{width:430,background:'#fff',borderRadius:16,padding:28,boxShadow:'0 12px 40px #0002'}}>
      <h1 style={{marginTop:0}}>إعداد جهاز Bold POS</h1>
      <p className="small" style={{lineHeight:1.7}}>هذا الجهاز غير مسجل. اطلب من مدير الفرع إنشاء رمز من صفحة <b>أجهزة نقاط البيع</b> في لوحة الإدارة. التسجيل الأول يتطلب اتصالاً بالإنترنت.</p>
      <label htmlFor="enrollment-code">رمز تسجيل الجهاز</label>
      <input id="enrollment-code" className="barcode-input" style={{fontSize:22,letterSpacing:3,margin:'6px 0 14px',direction:'ltr'}} value={code} onChange={event=>setCode(event.target.value.toUpperCase().replace(/\s/g,'').slice(0,12))} placeholder="XXXXXXXXXXXX" autoFocus />
      {error&&<div style={{color:'#b91c1c',marginBottom:12}} role="alert">{error}</div>}
      <button className="pay-btn accent" style={{width:'100%'}} disabled={loading}>{loading?'جارٍ تسجيل الجهاز…':'تسجيل الجهاز'}</button>
    </form>
  </div>
}

function LoginScreen({ onLogin }: { onLogin: (branchId: string) => void }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [field, setField] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedPhone = phone.trim().replace(/\s+/g, '')
    if (!normalizedPhone) { setField('phone'); setError('أدخل رقم الهاتف المسجل لحساب الكاشير.'); return }
    if (password.length < 8) { setField('password'); setError('كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.'); return }
    setLoading(true)
    setError(''); setField('')
    try {
      const session = await api.login(normalizedPhone, password)
      onLogin(session.user.branch_id!)
    } catch (err: any) {
      setField(err?.field || '')
      setError(`${err.message || 'تعذر تسجيل الدخول'}${err?.requestId ? ` — المرجع: ${err.requestId}` : ''}`)
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
        <input className="barcode-input" style={{fontSize:18, margin:'6px 0 14px', borderColor:field==='phone'?'#b91c1c':undefined}} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+201xxxxxxxxx" autoFocus aria-invalid={field==='phone'} />
        <label>كلمة المرور</label>
        <input className="barcode-input" style={{fontSize:18, margin:'6px 0 14px', borderColor:field==='password'?'#b91c1c':undefined}} type="password" value={password} onChange={e=>setPassword(e.target.value)} aria-invalid={field==='password'} />
        {error && <div style={{color:'#b91c1c', marginBottom:12}} role="alert">{error}</div>}
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
  const [booting, setBooting] = useState(true)
  const [enrolled, setEnrolled] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [terminalCode, setTerminalCode] = useState('')
  const [syncState, setSyncState] = useState<SyncState>({
    device_id:'', terminal_name:'', app_version:'', sync_status:'never', last_sync_at:null, last_error:null, pending_count:0,
  })
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.bootstrap().then(({device,user}) => {
      setEnrolled(!!device)
      setTerminalCode(device?.terminal_code || '')
      setBranchId(device?.branch_id || '')
      setAuthenticated(!!user)
    }).catch((error:any) => {
      alert('تعذر قراءة بيانات الجهاز الآمنة: ' + (error.message || error))
    }).finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    const expired = () => { setAuthenticated(false) }
    const invalidTerminal = () => { setAuthenticated(false); setEnrolled(false); setBranchId(''); setTerminalCode('') }
    window.addEventListener('bold-auth-expired', expired)
    window.addEventListener('bold-terminal-invalid', invalidTerminal)
    return () => { window.removeEventListener('bold-auth-expired', expired); window.removeEventListener('bold-terminal-invalid', invalidTerminal) }
  }, [])

  useEffect(()=>{
    if (!authenticated || !branchId) return
    barcodeRef.current?.focus()
    return startSync(branchId, setSyncState)
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

  const subtotal = fromCents(cart.reduce((sum,item)=>sum + toCents(item.unit_price) * item.qty, 0))
  const tax = fromCents(cart.reduce((sum,item)=>sum + toCents(item.unit_tax) * item.qty, 0))
  const total = fromCents(toCents(subtotal) + toCents(tax))

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
    let res: any
    try {
      res = await bold.sale(payload)
    } catch (error: any) {
      alert('تعذر إتمام البيع: ' + (error.message || 'المخزون المحلي غير كافٍ'))
      return
    }
    const receipt = { invoice_number: 'POS-'+res.sync_id.slice(0,8), total, items: cart }
    setCart([])
    setCustomerPhone('')
    barcodeRef.current?.focus()
    const syncPromise = syncLoop(branchId, setSyncState)
    const printResult = await bold.print(receipt, 'ar').catch((error:any)=>({ok:false,reason:error.message}))
    if (!printResult?.ok) {
      alert(`تم حفظ البيع ✓\nتعذرت طباعة الإيصال: ${printResult?.reason || 'تم إلغاء الطباعة'}\nلا تعِد إدخال البيع. رقم المزامنة: ${res.sync_id}`)
    } else {
      alert(`تم حفظ البيع وطباعة الإيصال ✓\nرقم المزامنة: ${res.sync_id}`)
    }
    syncPromise.catch(()=>undefined)
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

  if (booting) return <div className="pos" style={{display:'grid',placeItems:'center'}}><h2>جارٍ التحقق من الجهاز والجلسة…</h2></div>

  if (!enrolled || !branchId) {
    return <EnrollmentScreen onEnrolled={(id,code) => { setBranchId(id); setTerminalCode(code); setEnrolled(true) }} />
  }

  if (!authenticated) {
    return <LoginScreen onLogin={(id) => { setBranchId(id); setAuthenticated(true) }} />
  }

  const syncLabel = syncState.sync_status === 'success' ? 'متصل' : syncState.sync_status === 'syncing' ? 'جارٍ المزامنة' : syncState.sync_status === 'error' ? 'خطأ مزامنة' : syncState.sync_status === 'offline' ? 'غير متصل' : 'لم تتم المزامنة'
  const syncColor = syncState.sync_status === 'success' ? '#15803d' : syncState.sync_status === 'syncing' ? '#b45309' : '#b91c1c'

  return (
    <div className="pos">
      <div className="left">
        <div style={{display:'flex', gap:12, alignItems:'center'}}>
          <h2 style={{margin:0}}>Bold POS – نقطة بيع</h2>
          <span className="badge">الجهاز: {terminalCode || 'غير مسجل'}</span>
          <div className="sync-summary" style={{marginRight:'auto'}} title={syncState.last_error || ''}>
            <span className="sync-indicator" style={{background:syncColor}} />
            <div><b>{syncLabel}</b><div className="small">آخر مزامنة: {syncState.last_sync_at ? new Date(syncState.last_sync_at).toLocaleString('ar-EG') : 'لم تتم'} · معلق: {syncState.pending_count} · v{syncState.app_version||'—'}</div></div>
          </div>
          <button disabled={syncState.sync_status==='syncing'} onClick={()=>syncLoop(branchId,setSyncState)}>مزامنة الآن</button>
          <button onClick={async()=>{ await api.logout(); setAuthenticated(false) }}>خروج</button>
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
                  <td>{it.unit_price.toFixed(2)} ج</td>
                  <td>{fromCents(toCents(it.unit_price) * it.qty).toFixed(2)} ج</td>
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
          <div><span>المجموع الفرعي (غير شامل الضريبة)</span><b>{subtotal.toFixed(2)} ج</b></div>
          <div><span>ضريبة القيمة المضافة</span><b>{tax.toFixed(2)} ج</b></div>
          <div style={{fontSize:22, borderTop:'2px solid #111', paddingTop:8}}><span>الإجمالي شامل الضريبة</span><b>{total.toFixed(2)} ج</b></div>
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
