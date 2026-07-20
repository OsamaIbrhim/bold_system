import React, { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { DeviceCredential, Session, Shift, SyncState, AppView } from './types'
import { startSync, syncLoop } from './sync'
import { EnrollmentScreen } from './screens/EnrollmentScreen'
import { LoginScreen } from './screens/LoginScreen'
import { CloseShiftScreen, OpenShiftScreen } from './screens/ShiftScreens'
import { RegisterScreen } from './screens/RegisterScreen'
import { SalesScreen } from './screens/SalesScreen'
import { ScreenLoader, Toasts, ToastValue } from './components/ui'

const emptySync:SyncState={device_id:'',terminal_name:'',app_version:'',sync_status:'never',last_sync_at:null,last_error:null,pending_count:0}

export default function App(){
  const [booting,setBooting]=useState(true)
  const [device,setDevice]=useState<DeviceCredential|null>(null)
  const [session,setSession]=useState<Session|null>(null)
  const [shift,setShift]=useState<Shift|null>(null)
  const [checkingShift,setCheckingShift]=useState(false)
  const [closingShift,setClosingShift]=useState(false)
  const [view,setView]=useState<AppView>('register')
  const [syncState,setSyncState]=useState<SyncState>(emptySync)
  const [toasts,setToasts]=useState<ToastValue[]>([])

  const notify=useCallback((message:string,tone:'success'|'error'|'info'='info')=>{
    const id=crypto.randomUUID();setToasts((current)=>[...current,{id,message,tone}])
    window.setTimeout(()=>setToasts((current)=>current.filter((toast)=>toast.id!==id)),4500)
  },[])

  const resolveShift=useCallback(async(branchId:string)=>{
    setCheckingShift(true)
    try{
      const current=await api.currentShift(branchId)
      if(current){localStorage.setItem('bold_current_shift',JSON.stringify(current));setShift(current)}
      else{localStorage.removeItem('bold_current_shift');setShift(null)}
    }catch(error){
      const cached=localStorage.getItem('bold_current_shift')
      if(error instanceof ApiError&&error.code==='NETWORK_ERROR'&&cached){try{setShift(JSON.parse(cached));notify('تم فتح الوردية المحفوظة في وضع عدم الاتصال','info')}catch{setShift(null)}}
      else{setShift(null);notify((error as Error).message,'error')}
    }finally{setCheckingShift(false)}
  },[notify])

  useEffect(()=>{
    api.bootstrap().then((result)=>{
      setDevice(result.device)
      setSession(result.session)
      if(result.session?.user?.branch_id)resolveShift(result.session.user.branch_id)
    }).catch((error)=>notify(`تعذر بدء التطبيق: ${(error as Error).message}`,'error')).finally(()=>setBooting(false))
  },[notify,resolveShift])

  useEffect(()=>{
    const expired=()=>{setSession(null);setShift(null);setView('register')}
    const invalid=()=>{setSession(null);setShift(null);setDevice(null);setView('register')}
    window.addEventListener('bold-auth-expired',expired);window.addEventListener('bold-terminal-invalid',invalid)
    return()=>{window.removeEventListener('bold-auth-expired',expired);window.removeEventListener('bold-terminal-invalid',invalid)}
  },[])

  useEffect(()=>{
    if(!session||!shift||!device)return
    return startSync(device.branch_id,setSyncState)
  },[session,shift,device])

  const syncNow=useCallback(()=>{
    if(!device)return
    syncLoop(device.branch_id,setSyncState).then((state)=>{
      if(state.sync_status==='success')notify('اكتملت المزامنة','success')
      else if(state.last_error)notify(state.last_error,'error')
    })
  },[device,notify])

  if(booting)return <ScreenLoader message="جارٍ فحص الجهاز والجلسة الآمنة…"/>
  if(!device)return <EnrollmentScreen onEnrolled={(value)=>{setDevice(value);setSession(null);setShift(null)}}/>
  if(!session)return <LoginScreen device={device} onLogin={(value)=>{setSession(value);resolveShift(value.user.branch_id)}}/>
  if(checkingShift)return <ScreenLoader message="جارٍ التحقق من الوردية الحالية…"/>
  if(!shift)return <OpenShiftScreen session={session} device={device} onOpened={(value)=>{setShift(value);setView('register');notify('تم فتح الوردية','success')}}/>
  if(closingShift)return <CloseShiftScreen shift={shift} onCancel={()=>setClosingShift(false)} onClosed={async(value)=>{setClosingShift(false);setShift(null);notify(`أُغلقت الوردية. الفرق: ${Number(value.difference||0).toFixed(2)} ج`,'success');await api.logout();setSession(null)}}/>

  return <>
    {view==='register'
      ?<RegisterScreen session={session} device={device} shift={shift} syncState={syncState} onSync={syncNow} onSales={()=>setView('sales')} onCloseShift={()=>setClosingShift(true)} notify={notify}/>
      :<SalesScreen session={session} device={device} shift={shift} syncState={syncState} onRegister={()=>setView('register')} onSync={syncNow} onCloseShift={()=>setClosingShift(true)} notify={notify}/>
    }
    <Toasts values={toasts} dismiss={(id)=>setToasts((current)=>current.filter((toast)=>toast.id!==id))}/>
  </>
}
