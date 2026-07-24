'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, getStoredUser } from '@/lib/api'
import { loadDashboardData } from '@/lib/dashboard'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const today = new Date().toISOString().slice(0,10)
    try {
      const data = await loadDashboardData(apiGet, today)
      setStats(data.stats)
      setProductCount(data.productCount)
    } catch (loadError: any) {
      setError(loadError.message || 'تعذر تحميل بيانات لوحة التحكم')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">لوحة التحكم – Bold</h1>
      {error && (
        <div className="card border border-red-200 bg-red-50 text-red-800" role="alert">
          {error}{' '}
          <button className="underline" onClick={load}>إعادة المحاولة</button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card"><div className="text-sm text-gray-500">مبيعات اليوم</div><div className="text-2xl font-bold">{loading || error ? '—' : `${stats.total_sales} ج`}</div></div>
        <div className="card"><div className="text-sm text-gray-500">الربح</div><div className="text-2xl font-bold">{loading || error ? '—' : `${stats.profit} ج`}</div></div>
        <div className="card"><div className="text-sm text-gray-500">عدد الفواتير</div><div className="text-2xl font-bold">{loading || error ? '—' : stats.count}</div></div>
        <div className="card"><div className="text-sm text-gray-500">منتجات الكتالوج</div><div className="text-2xl font-bold">{loading || error ? '—' : productCount}</div></div>
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
