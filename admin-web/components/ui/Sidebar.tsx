'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiLogout, getStoredUser } from '@/lib/api'
const links = [
  ['/', 'لوحة التحكم', 'dashboard.read'],
  ['/sales', 'فواتير المبيعات', 'sales.read'],
  ['/products', 'المنتجات', 'products.read'],
  ['/inventory', 'المخزون', 'inventory.read'],
  ['/customers', 'العملاء', 'customers.read'],
  ['/purchasing', 'المشتريات', 'purchasing.read'],
  ['/suppliers', 'الموردون', 'suppliers.manage'],
  ['/pricing', 'التسعير', 'pricing.manage'],
  ['/offers', 'العروض', 'offers.manage'],
  ['/transfers', 'التحويلات', 'transfers.manage'],
  ['/shifts', 'الورديات', 'shifts.manage'],
  ['/terminals', 'أجهزة نقاط البيع', 'terminals.read'],
  ['/reports', 'التقارير', 'reports.read'],
  ['/branches', 'الفروع', 'branches.manage'],
  ['/users', 'المستخدمون والصلاحيات', 'users.manage'],
  ['/settings', 'الإعدادات', 'settings.manage'],
]
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
  const visible = links.filter(([, , capability]) => capabilities.includes(capability))
  return (
    <aside className="w-64 shrink-0 bg-bold text-white min-h-screen p-4 overflow-y-auto">
      <div className="text-2xl font-bold mb-6">Bold <span className="text-accent">Admin</span></div>
      <nav className="space-y-1">
        {visible.map(([href,label])=>(
          <Link key={href} href={href} className={`block px-3 py-2 rounded-xl ${p===href || (href !== '/' && p.startsWith(href))?'bg-white/15': 'hover:bg-white/10'}`}>{label}</Link>
        ))}
      </nav>
      {userName && <div className="text-sm text-white/70 mt-8">{userName}</div>}
      <div className="text-xs text-white/50 mt-8">ar-EG • EGP</div>
      <button className="mt-4 text-sm text-white/70" onClick={async()=>{ await apiLogout(); location.href='/login' }}>تسجيل الخروج</button>
    </aside>
  )
}
