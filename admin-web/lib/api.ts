const API_BASE = process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api/v1'

let refreshPromise: Promise<boolean> | null = null
const inFlightGets = new Map<string, Promise<any>>()

export type ApiErrorPayload = {
  code?: string
  message?: string
  message_ar?: string
  field?: string
  details?: string[]
  request_id?: string
}

const fieldLabels: Record<string, string> = {
  name: 'الاسم',
  name_ar: 'الاسم العربي',
  name_en: 'الاسم الإنجليزي',
  phone: 'رقم الهاتف',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  sku: 'رمز SKU',
  barcode_ean13: 'باركود EAN-13',
  barcode_internal: 'الباركود الداخلي',
  enrollment_code: 'رمز تسجيل الجهاز',
  branch_id: 'الفرع',
  quantity: 'الكمية',
}

export class ApiError extends Error {
  code: string
  field?: string
  details: string[]
  requestId?: string

  constructor(payload: ApiErrorPayload, status?: number) {
    const message = payload.message_ar || payload.message || `تعذر إتمام الطلب${status ? ` (HTTP ${status})` : ''}`
    const fieldHint = payload.field ? fieldLabels[payload.field] || payload.field : ''
    super(`${message}${fieldHint ? ` الحقل المطلوب مراجعته: ${fieldHint}.` : ''}`)
    this.name = 'ApiError'
    this.code = payload.code || 'REQUEST_FAILED'
    this.field = payload.field
    this.details = payload.details || []
    this.requestId = payload.request_id
  }
}

async function readApiError(response: Response) {
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => response.statusText) }))
  return new ApiError(body || {}, response.status)
}

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
  const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-request-id': requestId,
        ...(init.headers || {}),
      },
      cache: 'no-store',
    })
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message_ar: 'لا يمكن الوصول إلى الخادم. تحقق من تشغيل الخادم والاتصال بالشبكة ثم حاول مرة أخرى.',
      message: 'The server cannot be reached. Check the server and network, then try again.',
      request_id: requestId,
    })
  }
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
    throw await readApiError(res)
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

export async function apiGet(path: string) {
  const existing = inFlightGets.get(path)
  if (existing) return existing
  const request = authorizedFetch(path)
    .then(response => handleResponse(response, path))
    .finally(() => inFlightGets.delete(path))
  inFlightGets.set(path, request)
  return request
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

export async function apiGetBlob(path: string) {
  const response = await authorizedFetch(path)
  if (!response.ok) {
    throw await readApiError(response)
  }
  return response.blob()
}

export type AdminUser = {
  id: string
  name: string
  role: string
  branch_id: string | null
  capabilities?: string[]
}

export function getStoredUser(): AdminUser | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('user') || 'null') }
  catch { return null }
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
