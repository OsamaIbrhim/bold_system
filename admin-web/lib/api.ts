const API_BASE = process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api/v1'

let refreshPromise: Promise<boolean> | null = null

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

function clearSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
}

async function refreshSession() {
  if (typeof window === 'undefined') return false
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) return false
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).then(async (response) => {
      if (!response.ok) return false
      const session = await response.json()
      localStorage.setItem('token', session.access_token)
      localStorage.setItem('refresh_token', session.refresh_token)
      localStorage.setItem('user', JSON.stringify(session.user))
      return true
    }).catch(() => false).finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function authorizedFetch(path: string, init: RequestInit = {}, retry = true) {
  const token = getToken()
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
    cache: 'no-store',
  })
  if (response.status === 401 && retry && await refreshSession()) {
    return authorizedFetch(path, init, false)
  }
  return response
}

async function handleResponse(res: Response, path: string) {
  if (res.status === 401) {
    clearSession()
    if (typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?next=${next}`
    }
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const text = await res.text().catch(()=>res.statusText)
    throw new Error(text || `HTTP ${res.status} – ${path}`)
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

export async function apiGet(path: string) {
  return handleResponse(await authorizedFetch(path), path)
}

export async function apiPost(path: string, body: any) {
  return handleResponse(await authorizedFetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), path)
}

export async function apiPatch(path: string, body: any) {
  return handleResponse(await authorizedFetch(path, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), path)
}

export async function apiDelete(path: string) {
  return handleResponse(await authorizedFetch(path, { method: 'DELETE' }), path)
}

export async function apiLogout() {
  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null
  if (refreshToken) {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => undefined)
  }
  clearSession()
}

export const API = API_BASE
