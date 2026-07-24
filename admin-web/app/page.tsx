'use client'
import { useEffect, useState } from 'react'
import { apiGet, getStoredUser } from '@/lib/api'
import { hasCapability, type Capability } from '@/lib/permissions'

export default function Dashboard(){
  const user = getStoredUser()
  const quickLinks: { href: string; label: string; capability: Capability; className: string }[] = [
    { href: '/products', label: 'المنتجات', capability: 'products.read', className: 'btn' },
    { href: '/sales', label: 'المبيعات', capability: 'sales.read', className: 'btn' },
    { href: '/reports', label: 'التقارير', capability: 'reports.read', className: 'btn-accent' },
    { href: '/offers', label: 'العروض المقترحة', capability: 'offers.manage', className: 'btn' },
  ]
  const [stats, setStats] = useState({ total_sales:0, profit:0, count:0 })
  const [productCount, setProductCount] = useState(0)
  useEffect(() => {
    const today = new Date().toISOString().slice(0,10)
    apiGet(`/reports/sales?from=${today}&to=${today}`).then(setStats).catch(() => undefined)
    apiGet('/products?page=1&page_size=1').then(result => setProductCount(result.total || 0)).catch(() => undefined)
  }, [])
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">لوحة التحكم – Bold</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card"><div className="text-sm text-gray-500">مبيعات اليوم</div><div className="text-2xl font-bold">{stats.total_sales || 0} ج</div></div>
        <div className="card"><div className="text-sm text-gray-500">الربح</div><div className="text-2xl font-bold">{stats.profit || 0} ج</div></div>
        <div className="card"><div className="text-sm text-gray-500">عدد الفواتير</div><div className="text-2xl font-bold">{stats.count || 0}</div></div>
        <div className="card"><div className="text-sm text-gray-500">منتجات الكتالوج</div><div className="text-2xl font-bold">{productCount}</div></div>
      </div>
      <div className="card">
        <h2 className="font-bold mb-3">روابط سريعة</h2>
        <div className="flex gap-3 flex-wrap">
          {quickLinks
            .filter(({ capability }) => hasCapability(user, capability))
            .map(({ href, label, className }) => <a key={href} href={href} className={className}>{label}</a>)}
        </div>
      </div>
      <div className="text-sm text-gray-500">API: {process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api/v1'}</div>
    </div>
  )
}
