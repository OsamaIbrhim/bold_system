'use client'
import { useState } from 'react'
import { API } from '@/lib/api'
export default function Login(){
  const [phone,setPhone] = useState('')
  const [password,setPassword] = useState('')
  const [msg,setMsg] = useState('')
  const submit = async () => {
    const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({phone,password})})
    const j = await r.json()
    if(j.access_token){
      localStorage.setItem('token', j.access_token)
      localStorage.setItem('refresh_token', j.refresh_token)
      localStorage.setItem('user', JSON.stringify(j.user))
      setMsg('تم تسجيل الدخول ✓')
      const requested = new URLSearchParams(location.search).get('next') || '/'
      location.href=requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'
    }
    else setMsg('فشل تسجيل الدخول')
  }
  return (
    <div className="card max-w-sm mx-auto mt-20">
      <h1 className="text-xl font-bold mb-4">تسجيل الدخول – Bold</h1>
      <input className="input mb-2" placeholder="الهاتف" value={phone} onChange={e=>setPhone(e.target.value)} />
      <input className="input mb-3" type="password" placeholder="كلمة المرور" value={password} onChange={e=>setPassword(e.target.value)} />
      <button className="btn w-full" onClick={submit}>دخول</button>
      <div className="text-sm mt-2 text-gray-600">{msg}</div>
    </div>
  )
}
