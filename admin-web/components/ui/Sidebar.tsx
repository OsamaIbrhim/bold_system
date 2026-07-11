'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
const links = [
  ['/', 'لوحة التحكم'],
  ['/products', 'المنتجات'],
  ['/inventory', 'المخزون'],
  ['/sales', 'المبيعات'],
  ['/customers', 'العملاء'],
  ['/pricing', 'التسعير'],
  ['/offers', 'العروض'],
  ['/transfers', 'التحويلات'],
  ['/reports', 'التقارير'],
  ['/settings', 'الإعدادات'],
]
export default function Sidebar(){
  const p = usePathname()
  return (
    <aside className="w-64 bg-bold text-white min-h-screen p-4">
      <div className="text-2xl font-bold mb-6">Bold <span className="text-accent">Admin</span></div>
      <nav className="space-y-1">
        {links.map(([href,label])=>(
          <Link key={href} href={href} className={`block px-3 py-2 rounded-xl ${p===href?'bg-white/15': 'hover:bg-white/10'}`}>{label}</Link>
        ))}
      </nav>
      <div className="text-xs text-white/50 mt-8">ar-EG • EGP</div>
    </aside>
  )
}
