'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { normalizeUserPhone, validateUserPhone } from '@/lib/user-form'

const roleNames: Record<string, string> = {
  owner: 'مالك',
  branch_manager: 'مدير فرع',
  cashier: 'كاشير',
  warehouse_manager: 'مدير مخزن',
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

  const load = () => Promise.all([apiGet('/users'), apiGet('/branches')])
    .then(([users, branchList]) => {
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
        branch_id: branch || undefined,
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
            {Object.entries(roleNames).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className="select" value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="">بدون فرع</option>
            {branches.map((item) => (
              <option key={item.id} value={item.id}>{item.name_ar}</option>
            ))}
          </select>
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
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">
                  لا يوجد مستخدمون بعد. أنشئ أول حساب وحدد دوره والفرع المرتبط به.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
