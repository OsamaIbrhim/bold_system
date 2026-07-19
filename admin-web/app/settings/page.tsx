'use client'
import Link from 'next/link'
import { API, getStoredUser } from '@/lib/api'

export default function Settings(){
  const user=getStoredUser()
  const cards=[['الفروع','إدارة بيانات الفروع وإعداد درج النقد','/branches'],['المستخدمون والصلاحيات','إنشاء حسابات وربطها بالأدوار والفروع','/users'],['أجهزة نقاط البيع','مراقبة الاتصال والمزامنة وإلغاء الأجهزة','/terminals'],['الورديات','فتح وإغلاق ومراجعة فروق النقد','/shifts']]
  return <div className="space-y-4"><div><h1 className="text-2xl font-bold">الإعدادات والإدارة</h1><p className="text-sm text-gray-500">كل إعداد يقود إلى شاشة تشغيلية؛ لا توجد عناصر تجريبية في هذه الصفحة.</p></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{cards.map(([title,desc,href])=><Link href={href} key={href} className="card hover:ring-2 hover:ring-amber-400"><h2 className="font-bold text-lg">{title}</h2><p className="text-gray-600 mt-1">{desc}</p></Link>)}</div><div className="card"><h2 className="font-bold mb-2">معلومات الجلسة</h2><div className="grid md:grid-cols-2 gap-2 text-sm"><div>المستخدم: <b>{user?.name||'—'}</b></div><div>الدور: <b>{user?.role||'—'}</b></div><div>API: <code>{API}</code></div><div>عدد الصلاحيات: <b>{user?.capabilities?.length||0}</b></div></div></div></div>
}
