import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { bold } from '../electron'
import { CartItem, Customer, DeviceCredential, Product, Session, Shift, SyncState } from '../types'
import { ConfirmDialog, FieldError, Modal, NumericKeypad } from '../components/ui'
import { cartTotals, isValidEgyptianPhone, money, normalizeEgyptianPhone, paymentLabel, readHeldSales, removeHeldSale, saveHeldSale } from '../utils'

const paymentMethods = ['cash','card','instapay','vodafone_cash','installment'] as const

function displayName(product: Product) { return product.name_ar || product.name_en || product.sku }

function catalogIsFresh(validUntil?: string | null) {
  const timestamp = new Date(validUntil || 0).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function hasSignedPrice(item: Pick<Product, 'price_version' | 'price_token'>) {
  return !!item.price_version && !!item.price_token
}

export function RegisterScreen({
  session, device, shift, syncState, onSync, onSales, onCloseShift, notify,
}:{
  session:Session, device:DeviceCredential, shift:Shift, syncState:SyncState,
  onSync:()=>void, onSales:()=>void, onCloseShift:()=>void,
  notify:(message:string,tone?:'success'|'error'|'info')=>void,
}) {
  const [cart,setCart]=useState<CartItem[]>([])
  const [query,setQuery]=useState('')
  const [results,setResults]=useState<Product[]>([])
  const [searching,setSearching]=useState(false)
  const [customer,setCustomer]=useState<Customer|null>(null)
  const [customerOpen,setCustomerOpen]=useState(false)
  const [checkoutOpen,setCheckoutOpen]=useState(false)
  const [heldOpen,setHeldOpen]=useState(false)
  const [confirmClear,setConfirmClear]=useState(false)
  const [completed,setCompleted]=useState<any>(null)
  const searchRef=useRef<HTMLInputElement | null>(null)
  const totals=useMemo(()=>cartTotals(cart),[cart])

  const runSearch=async(value=query)=>{
    const term=value.trim(); if(!term)return
    setSearching(true)
    try{
      const local=await bold.search(term)
      if(local.length===1 && [local[0].barcode_ean13,local[0].barcode_internal,local[0].sku].includes(term)){await addProduct(local[0]);setResults([])}
      else setResults(local)
      if(!local.length) notify('لا توجد نتائج مطابقة في بيانات الجهاز','info')
    }catch{notify('تعذر البحث في كتالوج الجهاز','error')}
    finally{setSearching(false);setQuery('');setTimeout(()=>searchRef.current?.focus(),0)}
  }

  const addProduct=async(product:Product)=>{
    // Barcode search already returns the synchronized local stock quantity.
    // Only use a second IPC read as a compatibility fallback for older rows.
    const cachedAvailable=Number(product.qty)
    const available=Number.isFinite(cachedAvailable)
      ? cachedAvailable
      : Number(await bold.stock(product.id))

    const existing=cart.find((item)=>item.variant_id===product.id)
    if(!existing && !hasSignedPrice(product)){
      notify(
        navigator.onLine
          ? 'تم اكتشاف كتالوج أسعار قديم. جارٍ تحميل نسخة موقعة كاملة؛ أعد مسح المنتج بعد اكتمال المزامنة.'
          : 'كتالوج الأسعار يحتاج ترقية لمرة واحدة. شغّل الإنترنت وسيتم تحميل النسخة الموقعة تلقائيًا.',
        'error',
      )
      onSync()
      return
    }
    if(existing && existing.qty>=available){notify('لا توجد كمية إضافية متاحة من هذا الصنف','error');return}
    if(!existing && available<=0){notify('هذا المقاس غير متوفر في مخزون الفرع','error');return}

    // The synchronized SQLite catalog is the register pricing snapshot.
    // Adding/scanning an item must never wait for the network. Existing cart
    // lines keep their original snapshot for the lifetime of the sale.
    const price=Number(product.selling_price||0)
    const tax=Number(product.unit_tax||0)

    if(!Number.isFinite(price) || price<=0){
      notify('لا يوجد سعر بيع محلي معتمد لهذا الصنف. نفّذ مزامنة الكتالوج أولًا.','error')
      return
    }
    if(!Number.isFinite(tax) || tax<0){
      notify('بيانات ضريبة الصنف المحلية غير صالحة. نفّذ مزامنة الكتالوج أولًا.','error')
      return
    }

    setCart((current)=>existing
      ? current.map((item)=>item.variant_id===product.id?{...item,qty:item.qty+1}:item)
      : [...current,{...product,variant_id:product.id,name:displayName(product),qty:1,unit_price:price,unit_tax:tax,available_qty:available}])
    notify(`تمت إضافة ${displayName(product)}`,'success')
  }

  const changeQty=(variantId:string,next:number)=>{
    setCart((current)=>current.flatMap((item)=>{
      if(item.variant_id!==variantId)return [item]
      if(next<=0)return []
      if(next>item.available_qty){notify(`المتاح من ${item.name}: ${item.available_qty}`,'error');return [item]}
      return [{...item,qty:next}]
    }))
  }

  const holdSale=()=>{
    if(!cart.length){notify('السلة فارغة','info');return}
    saveHeldSale({items:cart,customer})
    setCart([]);setCustomer(null);notify('تم تعليق الفاتورة ويمكن استكمالها لاحقًا','success')
  }

  const openCheckout=()=>{
    if(!cart.length)return
    if(!catalogIsFresh(syncState.catalog_valid_until)){
      notify('انتهت صلاحية كتالوج الأسعار المحلي. نفّذ مزامنة ناجحة قبل تحصيل الدفع.','error')
      return
    }
    if(cart.some((item)=>!hasSignedPrice(item))){
      notify('تحتوي السلة على صنف بسعر قديم غير موقع. أزل الصنف وأعد إضافته بعد المزامنة.','error')
      return
    }
    setCheckoutOpen(true)
  }

  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==='F2'){event.preventDefault();searchRef.current?.focus()}
      if(event.key==='F3'){event.preventDefault();setCustomerOpen(true)}
      if(event.key==='F4'){event.preventDefault();holdSale()}
      if(event.key==='F8'){event.preventDefault();onSync()}
      if(event.key==='F10'){event.preventDefault();openCheckout()}
    }
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)
  },[cart,customer,onSync,syncState.catalog_valid_until])

  return <div className="app-shell">
    <header className="app-header">
      <div className="header-brand"><div className="brand-mark small">B</div><div><b>Bold POS</b><span>{device.terminal_code}</span></div></div>
      <nav className="main-nav"><button className="active">نقطة البيع</button><button onClick={onSales}>الفواتير والمرتجعات</button></nav>
      <div className="header-status"><button className={`sync-pill ${syncState.sync_status}`} onClick={onSync}><span/><b>{syncState.sync_status==='success'?'متصل':syncState.sync_status==='syncing'?'مزامنة…':syncState.sync_status==='offline'?'غير متصل':'تنبيه'}</b><small>{syncState.pending_count} معلّق</small></button><div className="cashier-chip"><b>{session.user.name}</b><span>وردية منذ {new Date(shift.opened_at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span></div><button className="button secondary compact" onClick={onCloseShift}>إغلاق الوردية</button></div>
    </header>

    <main className="register-layout">
      <section className="catalog-panel">
        <div className="search-bar"><input ref={searchRef} value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')runSearch()}} placeholder="امسح الباركود أو ابحث بالـ SKU…" autoFocus/><button className="button primary" onClick={()=>runSearch()} disabled={searching}>{searching?'بحث…':'بحث'}</button></div>
        <div className="quick-actions"><button onClick={()=>setCustomerOpen(true)}>F3 · العميل <b>{customer?.name||customer?.phone||'بدون عميل'}</b></button><button onClick={holdSale}>F4 · تعليق الفاتورة</button><button onClick={()=>setHeldOpen(true)}>الفواتير المعلقة <b>{readHeldSales().length}</b></button></div>
        <div className="product-results">
          {results.map((product)=><button className="product-card" key={product.id} onClick={()=>addProduct(product)}><div><b>{displayName(product)}</b><span>{product.sku}</span></div><div className="variant-meta"><span>{product.color||'—'}</span><span>{product.size||'—'}</span></div><strong>{money(product.selling_price)} ج</strong></button>)}
          {!results.length&&<div className="catalog-empty"><div>⌁</div><h2>جاهز للمسح</h2><p>امسح باركود الصنف أو اكتب SKU ثم اضغط Enter.</p><span>F2 للعودة السريعة إلى البحث</span></div>}
        </div>
      </section>

      <aside className="cart-panel">
        <div className="cart-heading"><div><span className="eyebrow">الفاتورة الحالية</span><h2>{totals.quantity} قطعة</h2></div>{cart.length>0&&<button className="text-button danger-text" onClick={()=>setConfirmClear(true)}>تفريغ</button>}</div>
        <div className="cart-items">
          {cart.map((item)=><article className="cart-item" key={item.variant_id}><div className="cart-item-main"><b>{item.name}</b><span>{item.sku} · {item.color||'بدون لون'} · {item.size||'بدون مقاس'}</span><small>متاح {item.available_qty}</small></div><div className="qty-control"><button onClick={()=>changeQty(item.variant_id,item.qty-1)}>−</button><input value={item.qty} inputMode="numeric" onChange={(event)=>changeQty(item.variant_id,Number(event.target.value||0))}/><button onClick={()=>changeQty(item.variant_id,item.qty+1)}>+</button></div><div className="line-price"><b>{money(item.unit_price*item.qty)} ج</b><span>{money(item.unit_price)} × {item.qty}</span></div><button className="remove-item" onClick={()=>changeQty(item.variant_id,0)}>×</button></article>)}
          {!cart.length&&<div className="cart-empty"><div>🛍</div><b>السلة فارغة</b><span>أضف أول صنف لبدء الفاتورة.</span></div>}
        </div>
        <div className="cart-summary"><div><span>المجموع الفرعي</span><b>{money(totals.subtotal)} ج</b></div><div><span>الضريبة</span><b>{money(totals.tax)} ج</b></div><div className="grand-total"><span>الإجمالي</span><b>{money(totals.total)} ج</b></div>{!catalogIsFresh(syncState.catalog_valid_until)&&<FieldError>كتالوج الأسعار يحتاج مزامنة قبل الدفع.</FieldError>}<button className="checkout-button" disabled={!cart.length} onClick={openCheckout}><span>F10 · الدفع</span><b>{money(totals.total)} ج</b></button></div>
      </aside>
    </main>

    <CustomerModal open={customerOpen} value={customer} onSelect={(value)=>{setCustomer(value);setCustomerOpen(false)}} onClose={()=>setCustomerOpen(false)} notify={notify}/>
    <CheckoutModal open={checkoutOpen} items={cart} customer={customer} branchId={device.branch_id} catalogValidUntil={syncState.catalog_valid_until} totals={totals} onClose={()=>setCheckoutOpen(false)} onCompleted={(value)=>{setCheckoutOpen(false);setCart([]);setCustomer(null);setCompleted(value)}} notify={notify}/>
    <HeldSalesModal open={heldOpen} onClose={()=>setHeldOpen(false)} onResume={(sale)=>{setCart(sale.items);setCustomer(sale.customer);removeHeldSale(sale.id);setHeldOpen(false)}}/>
    <SaleSuccessModal value={completed} onClose={()=>{setCompleted(null);searchRef.current?.focus()}}/>
    <ConfirmDialog open={confirmClear} title="تفريغ السلة؟" message="سيتم حذف جميع الأصناف من الفاتورة الحالية." confirmLabel="تفريغ السلة" danger onClose={()=>setConfirmClear(false)} onConfirm={()=>{setCart([]);setConfirmClear(false)}}/>
  </div>
}

function CustomerModal({open,value,onSelect,onClose,notify}:{open:boolean,value:Customer|null,onSelect:(value:Customer|null)=>void,onClose:()=>void,notify:(message:string,tone?:'success'|'error'|'info')=>void}){
  const [phone,setPhone]=useState(value?.phone||'')
  const [name,setName]=useState(value?.name||'')
  const [found,setFound]=useState<Customer|null>(value)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{if(open){setPhone(value?.phone||'');setName(value?.name||'');setFound(value);setError('')}},[open,value])
  const lookup=async()=>{const normalized=normalizeEgyptianPhone(phone);if(!isValidEgyptianPhone(normalized)){setError('أدخل رقمًا مصريًا صحيحًا مثل 01012345678.');return}setLoading(true);setError('');try{const result=await api.customerLookup(normalized);const customer=Array.isArray(result)?result[0]:result;setFound(customer||null);if(customer)setName(customer.name||'')}catch{setFound(null)}finally{setLoading(false)}}
  const create=async()=>{const normalized=normalizeEgyptianPhone(phone);if(!isValidEgyptianPhone(normalized)){setError('رقم الهاتف غير صحيح.');return}setLoading(true);try{const customer=await api.createCustomer({phone:normalized,name:name.trim()||undefined,whatsapp:normalized});notify('تم إنشاء العميل','success');onSelect(customer)}catch(err){setError((err as Error).message)}finally{setLoading(false)}}
  return <Modal open={open} title="العميل" onClose={onClose} width="560px"><div className="customer-form"><label>رقم الهاتف</label><div className="inline-field"><input dir="ltr" value={phone} onChange={(event)=>setPhone(event.target.value)} placeholder="01012345678" autoFocus/><button className="button secondary" onClick={lookup} disabled={loading}>بحث</button></div><FieldError>{error}</FieldError>{found?<div className="customer-card"><div><b>{found.name||'عميل بدون اسم'}</b><span dir="ltr">{found.phone}</span></div><div><span>{found.total_invoices||0} فاتورة</span><span>{money(found.total_spent)} ج مشتريات</span>{found.is_vip&&<strong>VIP</strong>}</div><button className="button primary" onClick={()=>onSelect(found)}>اختيار العميل</button></div>:<div className="new-customer"><label>اسم العميل الجديد (اختياري)</label><input value={name} onChange={(event)=>setName(event.target.value)} placeholder="اسم العميل"/><button className="button primary" onClick={create} disabled={loading}>إنشاء واختيار العميل</button></div>}<button className="button ghost full" onClick={()=>onSelect(null)}>إكمال البيع بدون عميل</button></div></Modal>
}

function CheckoutModal({open,items,customer,branchId,catalogValidUntil,totals,onClose,onCompleted,notify}:{open:boolean,items:CartItem[],customer:Customer|null,branchId:string,catalogValidUntil?:string|null,totals:ReturnType<typeof cartTotals>,onClose:()=>void,onCompleted:(value:any)=>void,notify:(message:string,tone?:'success'|'error'|'info')=>void}){
  const [method,setMethod]=useState<typeof paymentMethods[number]>('cash')
  const [received,setReceived]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{if(open){setMethod('cash');setReceived('');setBusy(false);setError('')}},[open])
  const receivedValue=Number(received||0),change=Math.max(0,receivedValue-totals.total)
  const confirm=async()=>{
    if(busy)return
    if(!catalogIsFresh(catalogValidUntil)){setError('انتهت صلاحية كتالوج الأسعار. أغلق شاشة الدفع ونفّذ مزامنة.');return}
    if(items.some((item)=>!hasSignedPrice(item))){setError('تحتوي الفاتورة على سعر غير موقع. أعد إضافة الصنف بعد المزامنة.');return}
    if(method==='cash'&&receivedValue<totals.total){setError('المبلغ المستلم أقل من إجمالي الفاتورة.');return}
    const phone=customer?.phone?normalizeEgyptianPhone(customer.phone):''
    if(phone&&!isValidEgyptianPhone(phone)){setError('رقم العميل غير صحيح. صححه أو أزل العميل من الفاتورة.');return}
    setBusy(true);setError('')
    const payload={sync_id:crypto.randomUUID(),branch_id:branchId,customer_phone:phone||undefined,items:items.map((item)=>({variant_id:item.variant_id,qty:item.qty,unit_price:item.unit_price,unit_tax:item.unit_tax,price_version:item.price_version,price_token:item.price_token})),payment_method:method,language:'ar',local_total:totals.total}
    try{
      const saved=await bold.sale(payload)
      const receipt={invoice_number:`POS-${saved.sync_id.slice(0,8).toUpperCase()}`,total:totals.total,subtotal:totals.subtotal,tax:totals.tax,payment_method:method,received:method==='cash'?receivedValue:undefined,change:method==='cash'?change:undefined,items}
      const printResult=await bold.print(receipt,'ar').catch((printError)=>({ok:false,reason:(printError as Error).message}))
      onCompleted({...receipt,sync_id:saved.sync_id,printed:!!printResult?.ok,print_error:printResult?.reason})
      notify('تم حفظ البيع محليًا بأمان','success')
    }catch(err){const value=err as Error;setError(value.message||'تعذر حفظ البيع محليًا');setBusy(false)}
  }
  return <Modal open={open} title="إتمام الدفع" onClose={()=>{if(!busy)onClose()}} width="920px"><div className="checkout-layout"><section><div className="checkout-total"><span>المبلغ المطلوب</span><b>{money(totals.total)} ج</b><small>{totals.quantity} قطعة · ضريبة {money(totals.tax)} ج</small></div><div className="payment-methods">{paymentMethods.map((value)=><button key={value} className={method===value?'active':''} onClick={()=>setMethod(value)}>{paymentLabel(value)}</button>)}</div>{method==='cash'&&<><label>المبلغ المستلم</label><div className="money-input"><input dir="ltr" inputMode="decimal" value={received} onChange={(event)=>setReceived(event.target.value)} autoFocus/><span>ج.م</span></div><div className="cash-presets"><button onClick={()=>setReceived(String(totals.total))}>المبلغ بالضبط</button>{[50,100,200,500,1000].filter((value)=>value>=totals.total).slice(0,4).map((value)=><button key={value} onClick={()=>setReceived(String(value))}>{value}</button>)}</div><div className="change-row"><span>الباقي للعميل</span><b>{money(change)} ج</b></div></>}<FieldError>{error}</FieldError></section>{method==='cash'&&<NumericKeypad value={received} onChange={setReceived}/>}</div><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={onClose}>رجوع</button><button className="button primary xl" disabled={busy} onClick={confirm}>{busy?'جارٍ حفظ البيع…':`تأكيد ${paymentLabel(method)}`}</button></div></Modal>
}

function HeldSalesModal({open,onClose,onResume}:{open:boolean,onClose:()=>void,onResume:(sale:any)=>void}){
  const sales=open?readHeldSales():[]
  return <Modal open={open} title="الفواتير المعلقة" onClose={onClose} width="720px"><div className="held-list">{sales.map((sale)=><article key={sale.id}><div><b>{sale.customer?.name||sale.customer?.phone||'بدون عميل'}</b><span>{new Date(sale.created_at).toLocaleString('ar-EG')}</span></div><div><b>{sale.items.reduce((sum:number,item:CartItem)=>sum+item.qty,0)} قطعة</b><span>{money(cartTotals(sale.items).total)} ج</span></div><button className="button primary" onClick={()=>onResume(sale)}>استكمال</button><button className="icon-button" onClick={()=>{removeHeldSale(sale.id);location.reload()}}>×</button></article>)}{!sales.length&&<div className="empty-state"><b>لا توجد فواتير معلقة</b><span>استخدم F4 لتعليق الفاتورة الحالية.</span></div>}</div></Modal>
}

function SaleSuccessModal({value,onClose}:{value:any,onClose:()=>void}){
  return <Modal open={!!value} title="تمت العملية" onClose={onClose} width="540px">{value&&<div className="success-state"><div className="success-icon">✓</div><h2>تم حفظ البيع</h2><b className="success-total">{money(value.total)} ج</b><div className="receipt-meta"><span>رقم العملية</span><code>{value.sync_id}</code><span>الطباعة</span><b className={value.printed?'ok':'warn'}>{value.printed?'تمت الطباعة':'لم تتم الطباعة'}</b>{value.change!==undefined&&<><span>الباقي</span><b>{money(value.change)} ج</b></>}</div>{!value.printed&&<FieldError>{value.print_error||'يمكن إعادة الطباعة من سجل الفواتير بعد المزامنة.'}</FieldError>}<button className="button primary xl full" onClick={onClose}>بيع جديد</button></div>}</Modal>
}
