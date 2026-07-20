import React, { useState } from 'react'
import { api, ApiError } from '../api'
import { DeviceCredential, Session } from '../types'
import { FieldError } from '../components/ui'

export function LoginScreen({
  device,
  onLogin,
}: {
  device: DeviceCredential,
  onLogin: (session: Session) => void,
}) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [field, setField] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = phone.trim().replace(/\s+/g, '')

    if (!normalized) {
      setField('phone')
      setError('أدخل رقم هاتف الكاشير.')
      return
    }

    if (password.length < 8) {
      setField('password')
      setError('كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.')
      return
    }

    setLoading(true)
    setError('')
    setField('')

    try {
      onLogin(await api.login(normalized, password))
    } catch (err) {
      const value = err as ApiError
      setField(value.field || '')
      setError(
        `${value.message}${value.requestId
          ? ` — المرجع: ${value.requestId}`
          : ''
        }`,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card login-card">
        <div className="auth-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="eyebrow">{device.terminal_code}</span>
            <h1>تسجيل دخول الكاشير</h1>
          </div>
        </div>
        <p className="muted">
          استخدم حساب كاشير أو مدير فرع مرتبط بنفس فرع هذا الجهاز.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="phone">رقم الهاتف</label>
          <input
            id="phone"
            dir="ltr"
            className={field === 'phone' ? 'invalid' : ''}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+201xxxxxxxxx"
            autoFocus
          />
          <label htmlFor="password">كلمة المرور</label>
          <div className="password-field">
            <input
              id="password"
              className={field === 'password' ? 'invalid' : ''}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'إخفاء' : 'إظهار'}
            </button>
          </div>
          <FieldError>{error}</FieldError>
          <button className="button primary large" disabled={loading}>
            {loading ? 'جارٍ التحقق…' : 'دخول'}
          </button>
        </form>
        <div className="auth-note">
          <b>الفرع</b>
          <span className="mono">{device.branch_id.slice(0, 8)}…</span>
        </div>
      </section>
    </main>
  )
}