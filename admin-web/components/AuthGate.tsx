'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(pathname === '/login')
  useEffect(() => {
    if (pathname === '/login') { setReady(true); return }
    if (!localStorage.getItem('token') || !localStorage.getItem('refresh_token')) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`)
      setReady(false)
      return
    }
    setReady(true)
  }, [pathname, router])
  return ready ? children : null
}
