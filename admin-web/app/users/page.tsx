'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPatch, apiPost, getStoredUser } from '@/lib/api'
import { normalizeUserPhone, validateUserPhone } from '@/lib/user-form'

const roleNames: Record<string, string> = {
  owner: 'مالك',
  branch_manager: 'مدير فرع',
  cashier: 'كاشير',
  warehouse_manager: 'مدير مخزن',
  seller: 'بائع',
}

const capabilityNames: Record<string, string> = {
  'dashboard.read': 'لوحة التحكم',
  'products.read': 'عرض المنتجات',
  'products.manage': 'إدارة المنتجات',
  'inventory.read': 'عرض المخزون',
  'sales.read': 'عرض المبيعات',
  'sales.create': 'إنشاء مبيعات',
  'returns.create': 'إنشاء مرتجعات',
  'customers.read': 'عرض العملاء',
  'customers.manage': 'إدارة العملاء',
  'purchasing.read': 'عرض المشتريات',
  'purchasing.manage': 'إدارة المشتريات',
  'suppliers.manage': 'إدارة الموردين',
  'pricing.manage': 'إدارة التسعير',
  'offers.manage': 'إدارة العروض',
  'transfers.manage': 'إدارة التحويلات',
  'reports.read': 'عرض التقارير',
  'reports.send': 'إرسال التقارير',
  'branches.manage': 'إدارة الفروع',
  'users.manage': 'إدارة المستخدمين',
  'shifts.manage': 'إدارة الورديات',
  'terminals.read': 'عرض أجهزة POS',
  'terminals.manage': 'إدارة أجهزة POS',
  'settings.manage': 'الإعدادات',
  'seller_reports.read': 'تقارير البائعين',
  'seller_settings.manage': 'إعدادات عمولات البائعين',
  'seller_periods.close': 'إقفال فترات البائعين',
}

export default function Users() {
  const [items, setItems] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [error, setError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('cashier')
  const [branch, setBranch] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [grants, setGrants] = useState<string[]>([])
  const [revokes, setRevokes] = useState<string[]>([])
  const actor = getStoredUser()

  const load = () => Promise.all([
    apiGet('/users'),
    actor?.role === 'owner' ? apiGet('/branches') : Promise.resolve([]),
  ]).then(([users, branchList]) => {
      setItems(users)
      setBranches(branchList)
    })
    .catch((loadError: any) => setError(loadError.message))

  useEffect(() => {
    load()
  }, [])

  const create = async () => {
    const validationError = validateUserPhone(phone)
    setPhoneError(validationError)
    setError('')
    if (validationError) return

    try {
      await apiPost('/users', {
        name: name.trim(),
        phone: normalizeUserPhone(phone),
        email: email.trim() || undefined,
        password,
        role,
        branch_id: actor?.role === 'owner'
          ? branch || undefined
          : actor?.branch_id || undefined,
      })
      setName('')
      setPhone('')
      setEmail('')
      setPassword('')
      await load()
    } catch (createError: any) {
      setError(createError.message)
    }
  }

  const canCreate = Boolean(name.trim() && phone.trim() && password.length >= 8)
  const savePermissions = async () => {
    if (!editing) return
    setError('')
    try {
      await apiPatch(`/users/${editing.id}/permissions`, {
        granted_capabilities: grants,
        revoked_capabilities: revokes,
      })
      setEditing(null)
      await load()
    } catch (saveError: any) {
      setError(saveError.message)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">المستخدمون والصلاحيات</h1>
      <div className="card">
        <h2 className="font-bold mb-3">مستخدم جديد</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            className="input"
            placeholder="الاسم *"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div>
            <input
              className={`input w-full ${phoneError ? 'border-red-600' : ''}`}
              placeholder="رقم الهاتف *"
              inputMode="tel"
              value={phone}
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? 'user-phone-error' : undefined}
              onChange={(event) => {
                setPhone(event.target.value)
                if (phoneError) setPhoneError('')
              }}
              onBlur={() => setPhoneError(validateUserPhone(phone))}
            />
            {phoneError && (
              <div id="user-phone-error" className="text-red-700 text-sm mt-1" role="alert">
                {phoneError}
              </div>
            )}
          </div>
          <input
            className="input"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="كلمة مرور 8 أحرف على الأقل"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <select className="select" value={role} onChange={(event) => setRole(event.target.value)}>
            {Object.entries(roleNames).filter(([value]) =>
              actor?.role === 'owner' ? value !== 'owner' : ['cashier', 'warehouse_manager', 'seller'].includes(value)
            ).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {actor?.role === 'owner' ? <select className="select" value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="">بدون فرع</option>
            {branches.map((item) => (
              <option key={item.id} value={item.id}>{item.name_ar}</option>
            ))}
          </select> : <div className="input bg-gray-50">فرعك الحالي</div>}
        </div>
        <button className="btn-accent mt-3" disabled={!canCreate} onClick={create}>
          إنشاء المستخدم
        </button>
        {error && <div className="text-red-700 mt-2" role="alert">{error}</div>}
      </div>

      <div className="card overflow-auto">
        <table>
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الهاتف</th>
              <th>البريد</th>
              <th>الدور</th>
              <th>الفرع</th>
              <th>الحالة</th>
              <th>الصلاحيات</th>
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.phone || '—'}</td>
                <td>{user.email || '—'}</td>
                <td>{roleNames[user.role] || user.role}</td>
                <td>{branches.find((item) => item.id === user.branch_id)?.name_ar || 'كل الفروع / غير محدد'}</td>
                <td>{user.is_active ? 'نشط' : 'معطل'}</td>
                <td><button className="btn" onClick={() => {
                  setEditing(user)
                  setGrants(user.granted_capabilities || [])
                  setRevokes(user.revoked_capabilities || [])
                }}>تعديل</button></td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  لا يوجد مستخدمون بعد. أنشئ أول حساب وحدد دوره والفرع المرتبط به.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <div className="card">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div><h2 className="font-bold">صلاحيات {editing.name}</h2><p className="text-sm text-gray-600">المنح يضيف فوق الدور، والسحب يتغلب على قالب الدور.</p></div>
          <button className="btn" onClick={() => setEditing(null)}>إلغاء</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {Object.entries(capabilityNames).map(([capability, label]) => {
            const granted = grants.includes(capability)
            const revoked = revokes.includes(capability)
            return <div key={capability} className="rounded border p-2">
              <div className="font-medium">{label}</div>
              <div className="flex gap-2 mt-2">
                <button className={granted ? 'btn-accent' : 'btn'} onClick={() => {
                  setGrants(current => granted ? current.filter(item => item !== capability) : [...current, capability])
                  setRevokes(current => current.filter(item => item !== capability))
                }}>منح</button>
                <button className={revoked ? 'btn-accent' : 'btn'} onClick={() => {
                  setRevokes(current => revoked ? current.filter(item => item !== capability) : [...current, capability])
                  setGrants(current => current.filter(item => item !== capability))
                }}>سحب</button>
              </div>
            </div>
          })}
        </div>
        <button className="btn-accent mt-3" onClick={savePermissions}>حفظ الصلاحيات</button>
      </div>}
    </div>
  )
}
