import React, { useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { DeviceCredential, Session, Shift } from '../types'
import { FieldError, NumericKeypad } from '../components/ui'
import { money } from '../utils'

export function OpenShiftScreen({ session, device, onOpened }:{session:Session,device:DeviceCredential,onOpened:(shift:Shift)=>void}) {
  const [cash,setCash]=useState('0')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault(); const value=Number(cash||0)
    if(!Number.isFinite(value)||value<0){setError('أدخل رصيد بداية صحيحًا.');return}
    setLoading(true);setError('')
    try{const shift=await api.openShift(device.branch_id,value);localStorage.setItem('bold_current_shift',JSON.stringify(shift));onOpened(shift)}
    catch(err){const value=err as ApiError;setError(`${value.message}${value.requestId?` — المرجع: ${value.requestId}`:''}`)}
    finally{setLoading(false)}
  }
  return <main className="shift-shell"><section className="shift-card"><header><div><span className="eyebrow">بداية يوم العمل</span><h1>فتح وردية جديدة</h1><p className="muted">سيُستخدم الرصيد الافتتاحي لحساب النقدية المتوقعة عند الإغلاق.</p></div><div className="shift-identity"><b>{session.user.name}</b><span>{device.terminal_code}</span></div></header>
    <form onSubmit={submit} className="shift-form"><div><label>رصيد بداية الدرج</label><div className="money-input"><input dir="ltr" inputMode="decimal" value={cash} onChange={(event)=>setCash(event.target.value)}/><span>ج.م</span></div><FieldError>{error}</FieldError></div><NumericKeypad value={cash} onChange={setCash}/><button className="button primary xl" disabled={loading}>{loading?'جارٍ فتح الوردية…':'فتح الوردية وبدء البيع'}</button></form>
  </section></main>
}

export function CloseShiftScreen({ shift, onCancel, onClosed }:{shift:Shift,onCancel:()=>void,onClosed:(shift:Shift)=>void}) {
  const [cash,setCash]=useState('')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const duration=useMemo(()=>Math.max(0,Date.now()-new Date(shift.opened_at).getTime()),[shift.opened_at])
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();const value=Number(cash)
    if(!Number.isFinite(value)||value<0){setError('أدخل النقدية الفعلية الموجودة في الدرج.');return}
    setLoading(true);setError('')
    try{const closed=await api.closeShift(shift.id,value);localStorage.removeItem('bold_current_shift');onClosed(closed)}
    catch(err){const value=err as ApiError;setError(`${value.message}${value.requestId?` — المرجع: ${value.requestId}`:''}`)}
    finally{setLoading(false)}
  }
  return <main className="shift-shell"><section className="shift-card"><header><div><span className="eyebrow">نهاية الوردية</span><h1>عدّ وإغلاق الدرج</h1><p className="muted">تأكد من مزامنة العمليات المعلقة قبل الإغلاق.</p></div><button className="button secondary" onClick={onCancel}>العودة للبيع</button></header>
    <div className="shift-summary"><div><span>رصيد البداية</span><b>{money(shift.opening_cash)} ج</b></div><div><span>مدة الوردية</span><b>{Math.floor(duration/3600000)} س {Math.floor(duration%3600000/60000)} د</b></div><div><span>بدأت</span><b>{new Date(shift.opened_at).toLocaleString('ar-EG')}</b></div></div>
    <form onSubmit={submit} className="shift-form"><div><label>النقدية الفعلية في الدرج</label><div className="money-input"><input dir="ltr" inputMode="decimal" value={cash} onChange={(event)=>setCash(event.target.value)} autoFocus/><span>ج.م</span></div><FieldError>{error}</FieldError></div><NumericKeypad value={cash} onChange={setCash}/><button className="button danger xl" disabled={loading}>{loading?'جارٍ إغلاق الوردية…':'تأكيد وإغلاق الوردية'}</button></form>
  </section></main>
}
