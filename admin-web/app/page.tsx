'use client'
import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'

export default function Dashboard(){
  const [stats, setStats] = useState({ total_sales:0, profit:0, count:0 })
  useEffect(() => {
    const today = new Date().toISOString().slice(0,10)
    apiGet(`/reports/sales?from=${today}&to=${today}`).then(setStats).catch(() => undefined)
  }, [])
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">لوحة التحكم – Bold</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card"><div className="text-sm text-gray-500">مبيعات اليوم</div><div className="text-2xl font-bold">{stats.total_sales || 0} ج</div></div>
        <div className="card"><div className="text-sm text-gray-500">الربح</div><div className="text-2xl font-bold">{stats.profit || 0} ج</div></div>
        <div className="card"><div className="text-sm text-gray-500">عدد الفواتير</div><div className="text-2xl font-bold">{stats.count || 0}</div></div>
        <div className="card"><div className="text-sm text-gray-500">المخزون البطئ</div><div className="text-2xl font-bold">—</div></div>
      </div>
      <div className="card">
        <h2 className="font-bold mb-3">روابط سريعة</h2>
        <div className="flex gap-3 flex-wrap">
          <a href="/products" className="btn">المنتجات</a>
          <a href="/sales" className="btn">المبيعات</a>
          <a href="/reports" className="btn-accent">التقارير</a>
          <a href="/offers" className="btn">العروض المقترحة</a>
        </div>
      </div>
      <div className="text-sm text-gray-500">API: {process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api/v1'}</div>
    </div>
  )
}
