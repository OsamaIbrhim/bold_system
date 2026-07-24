'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { apiGet } from '@/lib/api'
import { canAccessPath, firstAccessiblePath } from '@/lib/permissions'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(pathname === '/login')
  useEffect(() => {
    if (pathname === '/login') { setReady(true); return }
    setReady(false)
    if (!localStorage.getItem('token') || !localStorage.getItem('refresh_token')) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`)
      setReady(false)
      return
    }
    apiGet('/auth/me').then((user) => {
      localStorage.setItem('user', JSON.stringify(user))
      window.dispatchEvent(new Event('bold-user-updated'))
      if (!canAccessPath(user, pathname)) {
        router.replace(firstAccessiblePath(user))
        setReady(false)
        return
      }
      setReady(true)
    }).catch(() => setReady(true))
  }, [pathname, router])
  return ready ? children : null
}
