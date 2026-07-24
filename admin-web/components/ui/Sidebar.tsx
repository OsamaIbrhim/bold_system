'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiLogout, getStoredUser } from '@/lib/api'
import { NAV_ITEMS } from '@/lib/permissions'

export default function Sidebar(){
  const p = usePathname()
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [userName, setUserName] = useState('')
  useEffect(() => {
    const update = () => {
      const user = getStoredUser()
      setCapabilities(user?.capabilities || [])
      setUserName(user?.name || '')
    }
    update()
    window.addEventListener('bold-user-updated', update)
    return () => window.removeEventListener('bold-user-updated', update)
  }, [])
  if (p === '/login') return null
  const visible = NAV_ITEMS.filter(({ capability }) => capabilities.includes(capability))
  return (
    <aside className="w-64 shrink-0 bg-bold text-white min-h-screen p-4 overflow-y-auto">
      <div className="text-2xl font-bold mb-6">Bold <span className="text-accent">Admin</span></div>
      <nav className="space-y-1">
        {visible.map(({ href, label })=>(
          <Link key={href} href={href} className={`block px-3 py-2 rounded-xl ${p===href || (href !== '/' && p.startsWith(href))?'bg-white/15': 'hover:bg-white/10'}`}>{label}</Link>
        ))}
        {!visible.length&&<div className="rounded-lg bg-white/10 p-3 text-sm text-white/80">لم تُحمّل صلاحيات القائمة. تحقق من اتصال الخادم ثم أعد تسجيل الدخول.</div>}
      </nav>
      {userName && <div className="text-sm text-white/70 mt-8">{userName}</div>}
      <div className="text-xs text-white/50 mt-8">ar-EG • EGP</div>
      <button className="mt-4 text-sm text-white/70" onClick={async()=>{ await apiLogout(); location.href='/login' }}>تسجيل الخروج</button>
    </aside>
  )
}
