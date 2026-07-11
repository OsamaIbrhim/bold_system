const API_BASE = process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api/v1'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

function authHeader() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function handleResponse(res: Response, url: string) {
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?next=${next}`
    }
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const text = await res.text().catch(()=>res.statusText)
    throw new Error(text || `HTTP ${res.status} – ${url}`)
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

export async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeader() }, cache: 'no-store' })
  return handleResponse(res, path)
}

export async function apiPost(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json', ...authHeader() }, 
    body: JSON.stringify(body)
  })
  return handleResponse(res, path)
}

export async function apiPatch(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, { 
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() }, 
    body: JSON.stringify(body)
  })
  return handleResponse(res, path)
}

export async function apiDelete(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: { ...authHeader() }})
  return handleResponse(res, path)
}

export const API = API_BASE
