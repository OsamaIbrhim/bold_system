import React, { useState } from 'react'
import { api, ApiError } from '../api'
import { bold } from '../electron'
import { DeviceCredential } from '../types'
import { FieldError } from '../components/ui'

export function EnrollmentScreen({
  onEnrolled,
}: {
  onEnrolled: (device: DeviceCredential) => void,
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    if (code.trim().length !== 12) {
      setError('رمز التسجيل يجب أن يتكون من 12 حرفًا.')
      return
    }

    setLoading(true)

    try {
      const terminal = await bold.sync_get_status()
      onEnrolled(await api.enroll(code, terminal))
    } catch (err) {
      const value = err as ApiError
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
      <section className="auth-card enrollment-card">
        <div className="brand-mark">B</div>
        <span className="eyebrow">إعداد الجهاز</span>
        <h1>تسجيل Bold POS</h1>
        <p className="muted">
          أنشئ رمزًا مؤقتًا من صفحة أجهزة نقاط البيع في لوحة الإدارة، ثم أدخله
          هنا لربط الجهاز بالفرع.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="enrollment-code">رمز تسجيل الجهاز</label>
          <input
            id="enrollment-code"
            className="code-input"
            dir="ltr"
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/\s/g, '')
                  .slice(0, 12),
              )
            }
            placeholder="XXXXXXXXXXXX"
            autoFocus
          />
          <FieldError>{error}</FieldError>
          <button className="button primary large" disabled={loading}>
            {loading ? 'جارٍ تسجيل الجهاز…' : 'تسجيل الجهاز'}
          </button>
        </form>
        <div className="auth-note">
          <b>يتطلب إنترنت للمرة الأولى</b>
          <span>بعد التسجيل سيظل الجهاز مرتبطًا بنفس الفرع.</span>
        </div>
      </section>
    </main>
  )
}