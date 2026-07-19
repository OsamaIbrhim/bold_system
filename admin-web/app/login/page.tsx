'use client'
import { useState } from 'react'
import { API, ApiError } from '@/lib/api'
export default function Login(){
  const [phone,setPhone] = useState('')
  const [password,setPassword] = useState('')
  const [msg,setMsg] = useState('')
  const [field,setField] = useState('')
  const [loading,setLoading] = useState(false)
  const submit = async () => {
    const normalizedPhone = phone.trim().replace(/\s+/g, '')
    setField(''); setMsg('')
    if (!normalizedPhone) { setField('phone'); setMsg('أدخل رقم الهاتف المسجل للحساب.'); return }
    if (password.length < 8) { setField('password'); setMsg('كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.'); return }
    setLoading(true)
    try {
      const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({phone:normalizedPhone,password})})
      if (!r.ok) {
        const payload = await r.json().catch(()=>({}))
        throw new ApiError(payload, r.status)
      }
      const j = await r.json()
      localStorage.setItem('token', j.access_token)
      localStorage.setItem('refresh_token', j.refresh_token)
      localStorage.setItem('user', JSON.stringify(j.user))
      setMsg('تم تسجيل الدخول ✓')
      const requested = new URLSearchParams(location.search).get('next') || '/'
      location.href=requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError({})
      setField(apiError.field || '')
      setMsg(`${apiError.message}${apiError.requestId ? ` — المرجع: ${apiError.requestId}` : ''}`)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="card max-w-sm mx-auto mt-20">
      <h1 className="text-xl font-bold mb-4">تسجيل الدخول – Bold</h1>
      <label className="text-sm" htmlFor="phone">رقم الهاتف</label>
      <input id="phone" className={`input mb-2 ${field==='phone'?'border-red-600':''}`} placeholder="01xxxxxxxxx" value={phone} onChange={e=>setPhone(e.target.value)} autoFocus aria-invalid={field==='phone'} />
      <label className="text-sm" htmlFor="password">كلمة المرور</label>
      <input id="password" className={`input mb-3 ${field==='password'?'border-red-600':''}`} type="password" placeholder="8 أحرف على الأقل" value={password} onChange={e=>setPassword(e.target.value)} aria-invalid={field==='password'} onKeyDown={e=>{if(e.key==='Enter')submit()}} />
      <button className="btn w-full" onClick={submit} disabled={loading}>{loading?'جارٍ تسجيل الدخول…':'دخول'}</button>
      <div className={`text-sm mt-2 ${field?'text-red-700':'text-gray-600'}`} role="alert">{msg}</div>
    </div>
  )
}
