import { DeviceCredential, Invoice, Session, Shift } from './types'
import { bold } from './electron'

const API = (typeof localStorage !== 'undefined' && localStorage.getItem('bold_api')) || 'http://localhost:3000/api/v1'

type PersistedAuth = { session: Session, offline_valid_until: string }
type SecureState = { auth?: PersistedAuth, device?: DeviceCredential }

export class ApiError extends Error {
  code: string
  field?: string
  requestId?: string
  status?: number
  details: string[]

  constructor(payload: any = {}, status?: number) {
    super(payload.message_ar || payload.message || 'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.')
    this.name = 'ApiError'
    this.code = payload.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR')
    this.field = payload.field
    this.requestId = payload.request_id
    this.status = status
    this.details = Array.isArray(payload.details) ? payload.details.map(String) : []
  }
}

let session: Session | null = null
let persistedAuth: PersistedAuth | null = null
let device: DeviceCredential | null = null
let refreshPromise: Promise<boolean> | null = null

function validString(value: unknown): value is string {
  return typeof value === 'string' && !!value && value !== 'undefined' && value !== 'null'
}

export function validDevice(value: any): value is DeviceCredential {
  return value
    && validString(value.device_id)
    && validString(value.device_token)
    && validString(value.branch_id)
    && validString(value.terminal_id)
    && validString(value.terminal_code)
}

export function validAuth(value: any): value is PersistedAuth {
  return value?.session
    && validString(value.session.access_token)
    && validString(value.session.refresh_token)
    && validString(value.session.user?.id)
    && validString(value.session.user?.branch_id)
}

async function parseError(response: Response) {
  const payload = await response.json().catch(() => ({}))
  return new ApiError(payload, response.status)
}

async function saveSession(value: Session) {
  session = value
  persistedAuth = { session: value, offline_valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
  await bold.secure_set_auth(persistedAuth)
}

async function clearSession() {
  session = null
  persistedAuth = null
  await bold.secure_set_auth(null).catch(() => undefined)
  window.dispatchEvent(new Event('bold-auth-expired'))
}

async function clearDevice() {
  device = null
  await bold.secure_set_device(null).catch(() => undefined)
  await clearSession()
  window.dispatchEvent(new Event('bold-terminal-invalid'))
}

async function refreshSession() {
  if (!session?.refresh_token) return false
  if (!refreshPromise) {
    refreshPromise = fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then(async (response) => {
      if (!response.ok) return false
      await saveSession(await response.json())
      return true
    }).catch(() => false).finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function request<T = any>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(device?.device_token ? { 'x-pos-device-token': device.device_token } : {}),
        ...(device?.device_id ? { 'x-pos-device-id': device.device_id } : {}),
        'x-request-id': crypto.randomUUID(),
        ...(init.headers || {}),
      },
    })
  } catch {
    throw new ApiError({ code: 'NETWORK_ERROR', message_ar: 'لا يمكن الوصول إلى الخادم. تحقق من الإنترنت أو عنوان الخادم.' })
  }
  if (response.status === 401 && retry && await refreshSession()) return request<T>(path, init, false)
  if (!response.ok) {
    const error = await parseError(response)
    if (response.status === 401 && !['/auth/me', '/auth/login'].includes(path)) await clearSession()
    if (['TERMINAL_REVOKED', 'TERMINAL_NOT_ENROLLED', 'TERMINAL_CREDENTIAL_INVALID'].includes(error.code)) await clearDevice()
    throw error
  }
  return response.json()
}

export const api = {
  base: API,
  bootstrap: async () => {
    for (const key of ['token', 'refresh_token', 'user', 'branch_id']) localStorage.removeItem(key)
    const secure = await bold.secure_get() as SecureState
    if (validDevice(secure.device)) device = secure.device
    else if (secure.device) await bold.secure_set_device(null)
    if (validAuth(secure.auth)) {
      persistedAuth = secure.auth
      session = secure.auth.session
      if (!device || session.user.branch_id !== device.branch_id) {
        await clearSession()
      } else {
        try {
          const user = await request<any>('/auth/me')
          session.user = { ...session.user, ...user }
          await saveSession(session)
        } catch (error) {
          const offlineUntil = new Date(persistedAuth?.offline_valid_until || 0).getTime()
          if (!(error instanceof ApiError && error.code === 'NETWORK_ERROR' && offlineUntil > Date.now())) await clearSession()
        }
      }
    } else if (secure.auth) await bold.secure_set_auth(null)
    return { device, session, user: session?.user || null, offline: !!session && !navigator.onLine }
  },
  enroll: async (enrollmentCode: string, terminal: { device_id: string, terminal_name: string, app_version: string }) => {
    let response: Response
    try {
      response = await fetch(`${API}/terminals/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify({
          enrollment_code: enrollmentCode.trim().toUpperCase(),
          device_id: terminal.device_id,
          name: terminal.terminal_name,
          app_version: terminal.app_version,
        }),
      })
    } catch {
      throw new ApiError({ code: 'NETWORK_ERROR', message_ar: 'يجب الاتصال بالخادم لتسجيل هذا الجهاز للمرة الأولى.' })
    }
    if (!response.ok) throw await parseError(response)
    const result = await response.json()
    device = {
      device_id: terminal.device_id,
      device_token: result.device_token,
      branch_id: result.terminal.branch.id,
      terminal_id: result.terminal.id,
      terminal_code: result.terminal.terminal_code,
    }
    await bold.secure_set_device(device)
    return device
  },
  login: async (phone: string, password: string) => {
    const normalizedPhone = phone.trim().replace(/\s+/g, '')
    let response: Response
    try {
      response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify({ phone: normalizedPhone, password }),
      })
    } catch {
      throw new ApiError({ code: 'NETWORK_ERROR', message_ar: 'أول تسجيل دخول للكاشير يتطلب اتصالاً بالخادم.' })
    }
    if (!response.ok) throw await parseError(response)
    const value: Session = await response.json()
    if (!['branch_manager', 'cashier'].includes(value.user.role)) {
      throw new ApiError({ code: 'POS_ROLE_DENIED', message_ar: 'استخدم حساب كاشير أو مدير فرع في نقطة البيع.' })
    }
    if (!value.user.branch_id) {
      throw new ApiError({ code: 'USER_BRANCH_REQUIRED', message_ar: 'يجب ربط حساب الكاشير بفرع من لوحة الإدارة.' })
    }
    if (!device || value.user.branch_id !== device.branch_id) {
      throw new ApiError({ code: 'USER_BRANCH_MISMATCH', message_ar: 'حساب الكاشير تابع لفرع مختلف عن هذا الجهاز.' })
    }
    await saveSession(value)
    return value
  },
  logout: async () => {
    const refreshToken = session?.refresh_token
    if (refreshToken) {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => undefined)
    }
    await clearSession()
  },
  search: (q: string, branchId?: string) =>
    request<any[]>(`/products/search?q=${encodeURIComponent(q)}${branchId ? `&branch_id=${branchId}` : ''}`),
  sale: (payload: any) =>
    request<any>('/pos/sale', { method: 'POST', body: JSON.stringify(payload) }),
  pricing: (variantId: string) =>
    request<any>('/pricing/calculate', { method: 'POST', body: JSON.stringify({ variant_id: variantId }) }),
  customerLookup: (phone: string) =>
    request<any>(`/customers/lookup?phone=${encodeURIComponent(phone)}`),
  customerLoyalty: (phone: string) =>
    request<any>(`/customers/loyalty?phone=${encodeURIComponent(phone)}`),
  customers: (q: string) =>
    request<any[]>(`/customers?q=${encodeURIComponent(q)}`),
  createCustomer: (payload: any) =>
    request<any>('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  listSales: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value))
    })
    return request<{ items: Invoice[], total: number, total_pages: number }>(`/sales?${query.toString()}`)
  },
  getSale: (id: string) =>
    request<Invoice>(`/sales/${encodeURIComponent(id)}`),
  invoiceLookup: (reference: string) =>
    request<any>(`/pos/invoices/lookup?reference=${encodeURIComponent(reference)}`),
  returnSale: (payload: any) =>
    request<any>('/pos/return', { method: 'POST', body: JSON.stringify(payload) }),
  currentShift: (branchId: string) =>
    request<Shift | null>(`/shifts/current?branch_id=${encodeURIComponent(branchId)}`),
  openShift: (branchId: string, openingCash: number) =>
    request<Shift>('/shifts/open', { method: 'POST', body: JSON.stringify({ branch_id: branchId, opening_cash: openingCash }) }),
  closeShift: (id: string, closingCash: number) =>
    request<Shift>(`/shifts/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ closing_cash: closingCash }) }),
  pull: (branchId: string, cursor?: string | null) =>
    request<any>(`/sync/pull?branch_id=${encodeURIComponent(branchId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  heartbeat: (payload: any) =>
    request<any>('/terminals/heartbeat', { method: 'POST', body: JSON.stringify(payload) }),
}