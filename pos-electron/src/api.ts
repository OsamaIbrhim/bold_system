const API = (typeof localStorage !== 'undefined' && localStorage.getItem('bold_api')) || 'http://localhost:3000/api/v1'

type Session = {
  access_token: string
  refresh_token: string
  user: { id: string, name: string, role: string, branch_id: string | null }
}

let refreshPromise: Promise<boolean> | null = null

function saveSession(session: Session) {
  localStorage.setItem('token', session.access_token)
  localStorage.setItem('refresh_token', session.refresh_token)
  localStorage.setItem('user', JSON.stringify(session.user))
  if (session.user.branch_id) localStorage.setItem('branch_id', session.user.branch_id)
}

function clearSession() {
  localStorage.removeItem('token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
  localStorage.removeItem('branch_id')
  window.dispatchEvent(new Event('bold-auth-expired'))
}

async function refreshSession() {
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) return false
  if (!refreshPromise) {
    refreshPromise = fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).then(async (response) => {
      if (!response.ok) return false
      saveSession(await response.json())
      return true
    }).catch(() => false).finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function request(path: string, init: RequestInit = {}, retry = true) {
  const token = localStorage.getItem('token')
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  if (response.status === 401 && retry && await refreshSession()) {
    return request(path, init, false)
  }
  if (!response.ok) {
    if (response.status === 401) clearSession()
    throw new Error(await response.text())
  }
  return response.json()
}

export const api = {
  base: API,
  hasSession: () => Boolean(localStorage.getItem('token') && localStorage.getItem('refresh_token')),
  login: async (phone: string, password: string) => {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    })
    if (!response.ok) throw new Error('بيانات الدخول غير صحيحة')
    const session: Session = await response.json()
    if (!['owner', 'branch_manager', 'cashier'].includes(session.user.role)) {
      throw new Error('هذا الحساب غير مصرح له باستخدام نقطة البيع')
    }
    if (!session.user.branch_id) throw new Error('يجب ربط مستخدم نقطة البيع بفرع')
    saveSession(session)
    return session
  },
  logout: async () => {
    const refreshToken = localStorage.getItem('refresh_token')
    if (refreshToken) {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => undefined)
    }
    clearSession()
  },
  search: (q: string, branch_id?: string) =>
    request(`/products/search?q=${encodeURIComponent(q)}${branch_id ? `&branch_id=${branch_id}` : ''}`).catch(() => []),
  sale: (payload: any) => request('/pos/sale', { method: 'POST', body: JSON.stringify(payload) }),
  pricing: (variant_id: string) => request('/pricing/calculate', { method: 'POST', body: JSON.stringify({ variant_id }) }),
  customerLookup: (phone: string) => request(`/customers/lookup?phone=${encodeURIComponent(phone)}`),
  customerLoyalty: (phone: string) => request(`/customers/loyalty?phone=${encodeURIComponent(phone)}`),
  invoiceLookup: (reference: string) => request(`/pos/invoices/lookup?reference=${encodeURIComponent(reference)}`),
  returnSale: (payload: any) => request('/pos/return', { method: 'POST', body: JSON.stringify(payload) }),
  pull: (branch_id: string) => request(`/sync/pull?branch_id=${encodeURIComponent(branch_id)}`),
}
