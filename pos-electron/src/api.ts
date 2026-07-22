import {
  DeviceCredential,
  Invoice,
  OfflineAccountingContext,
  ReturnRecord,
  Session,
  Shift,
} from './types'
import {
  isValidOfflineAccountingContext,
  offlineAccountingContextMatches,
} from '../electron/offline-accounting'
import { bold } from './electron'

const DEFAULT_API = import.meta.env.PROD
  ? 'https://boldsystem-production.up.railway.app/api/v1'
  : 'http://localhost:3000/api/v1'

const API =
  (typeof localStorage !== 'undefined' && localStorage.getItem('bold_api')) ||
  DEFAULT_API

const REQUEST_TIMEOUT_MS = 15_000
const TERMINAL_CONFIRMATION_DELAY_MS = 2_000
const TERMINAL_CONFIRMATION_WINDOW_MS = 60_000

const TERMINAL_INVALID_CODES = new Set([
  'TERMINAL_REVOKED',
  'TERMINAL_NOT_ENROLLED',
  'TERMINAL_CREDENTIAL_INVALID',
])

type PersistedAuth = { session: Session; offline_valid_until: string }
type SecureState = {
  auth?: PersistedAuth
  device?: DeviceCredential
  accounting?: OfflineAccountingContext
}
type RefreshResult = 'refreshed' | 'rejected' | 'network_error'
type TerminalEvidence = {
  code: string
  first_seen_at: number
}

export type TerminalCredentialDisposition = 'ignore' | 'confirm' | 'clear'

export class ApiError extends Error {
  code: string
  field?: string
  requestId?: string
  status?: number
  details: string[]

  constructor(payload: any = {}, status?: number) {
    super(
      payload.message_ar ||
        payload.message ||
        'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.',
    )
    this.name = 'ApiError'
    this.code = payload.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR')
    this.field = payload.field
    this.requestId = payload.request_id
    this.status = status
    this.details = Array.isArray(payload.details)
      ? payload.details.map(String)
      : []
  }
}

let session: Session | null = null
let persistedAuth: PersistedAuth | null = null
let device: DeviceCredential | null = null
let accountingContext: OfflineAccountingContext | null = null
let refreshPromise: Promise<RefreshResult> | null = null
let terminalEvidence: TerminalEvidence | null = null

function validString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value &&
    value !== 'undefined' &&
    value !== 'null'
  )
}

export function validDevice(value: any): value is DeviceCredential {
  return (
    value &&
    validString(value.device_id) &&
    validString(value.device_token) &&
    validString(value.branch_id) &&
    validString(value.terminal_id) &&
    validString(value.terminal_code)
  )
}

export function validAuth(value: any): value is PersistedAuth {
  return (
    value?.session &&
    validString(value.session.access_token) &&
    validString(value.session.refresh_token) &&
    validString(value.session.user?.id) &&
    validString(value.session.user?.branch_id)
  )
}

export function validOfflineAccountingContext(
  value: unknown,
  nowMs = Date.now(),
) {
  return isValidOfflineAccountingContext(value, nowMs)
}

function currentContextMatches(
  context: unknown,
  shift: Pick<Shift, 'id' | 'branch_id'>,
  minimumRemainingMs = 0,
) {
  return !!session && !!device && offlineAccountingContextMatches(
    context,
    { session, device, shift },
    Date.now(),
    minimumRemainingMs,
  )
}

async function clearAccountingContext() {
  accountingContext = null
  await bold.secure_set_accounting(null).catch(() => undefined)
}

export function terminalCredentialDisposition(
  code: string,
  path: string,
): TerminalCredentialDisposition {
  if (!TERMINAL_INVALID_CODES.has(code)) return 'ignore'
  if (code === 'TERMINAL_REVOKED') return 'clear'
  return path === '/terminals/heartbeat' ? 'confirm' : 'ignore'
}

function browserIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function registerTerminalFailure(code: string, path: string) {
  const disposition = terminalCredentialDisposition(code, path)
  if (disposition === 'ignore') return false
  if (disposition === 'clear') return browserIsOnline()
  if (!browserIsOnline()) return false

  const now = Date.now()
  if (
    !terminalEvidence ||
    terminalEvidence.code !== code ||
    now - terminalEvidence.first_seen_at > TERMINAL_CONFIRMATION_WINDOW_MS
  ) {
    terminalEvidence = { code, first_seen_at: now }
    return false
  }

  if (now - terminalEvidence.first_seen_at < TERMINAL_CONFIRMATION_DELAY_MS) {
    return false
  }

  terminalEvidence = null
  return true
}

function resetTerminalFailure(path: string) {
  if (path === '/terminals/heartbeat') terminalEvidence = null
}

function networkError(message?: string) {
  return new ApiError({
    code: 'NETWORK_ERROR',
    message_ar:
      message ||
      'لا يمكن الوصول إلى الخادم. تحقق من الإنترنت أو عنوان الخادم.',
  })
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

async function parseError(response: Response) {
  const payload = await response.json().catch(() => ({}))
  return new ApiError(payload, response.status)
}

async function saveSession(value: Session) {
  session = value
  persistedAuth = {
    session: value,
    offline_valid_until: new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString(),
  }
  await bold.secure_set_auth(persistedAuth)
}

async function clearSession() {
  session = null
  persistedAuth = null
  accountingContext = null
  await bold.secure_set_auth(null).catch(() => undefined)
  window.dispatchEvent(new Event('bold-auth-expired'))
}

async function clearDevice() {
  device = null
  terminalEvidence = null
  accountingContext = null
  await bold.secure_set_device(null).catch(() => undefined)
  session = null
  persistedAuth = null
  window.dispatchEvent(new Event('bold-auth-expired'))
  window.dispatchEvent(new Event('bold-terminal-invalid'))
}

async function refreshSession(): Promise<RefreshResult> {
  if (!session?.refresh_token) return 'rejected'

  if (!refreshPromise) {
    refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        const response = await fetchWithTimeout(`${API}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': crypto.randomUUID(),
          },
          body: JSON.stringify({ refresh_token: session?.refresh_token }),
        })

        if (!response.ok) return 'rejected'
        await saveSession(await response.json())
        return 'refreshed'
      } catch {
        return 'network_error'
      }
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

async function request<T = any>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  let response: Response

  try {
    response = await fetchWithTimeout(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
        ...(device?.device_token
          ? { 'x-pos-device-token': device.device_token }
          : {}),
        ...(device?.device_id ? { 'x-pos-device-id': device.device_id } : {}),
        'x-request-id': crypto.randomUUID(),
        ...(init.headers || {}),
      },
    })
  } catch {
    throw networkError()
  }

  if (response.status === 401 && retry) {
    const refresh = await refreshSession()

    if (refresh === 'refreshed') {
      return request<T>(path, init, false)
    }

    if (refresh === 'network_error') {
      throw networkError(
        'انقطع الاتصال أثناء تجديد الجلسة. لم يتم حذف تسجيل الجهاز أو بيانات الدخول.',
      )
    }
  }

  if (!response.ok) {
    const error = await parseError(response)

    if (TERMINAL_INVALID_CODES.has(error.code)) {
      if (registerTerminalFailure(error.code, path)) {
        await clearDevice()
      }
      throw error
    }

    if (
      response.status === 401 &&
      !['/auth/me', '/auth/login'].includes(path)
    ) {
      await clearSession()
    }

    throw error
  }

  resetTerminalFailure(path)
  return response.json()
}

export const api = {
  base: API,

  bootstrap: async () => {
    for (const key of ['token', 'refresh_token', 'user', 'branch_id']) {
      localStorage.removeItem(key)
    }

    const secure = (await bold.secure_get()) as SecureState
    device = null
    session = null
    persistedAuth = null
    accountingContext = null

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
          const offlineUntil = new Date(
            persistedAuth?.offline_valid_until || 0,
          ).getTime()

          if (
            !(
              error instanceof ApiError &&
              error.code === 'NETWORK_ERROR' &&
              offlineUntil > Date.now()
            )
          ) {
            await clearSession()
          }
        }
      }
    } else if (secure.auth) {
      await bold.secure_set_auth(null)
    }

    if (
      session &&
      device &&
      secure.accounting &&
      isValidOfflineAccountingContext(secure.accounting) &&
      secure.accounting.user_id === session.user.id &&
      secure.accounting.role === session.user.role &&
      secure.accounting.branch_id === session.user.branch_id &&
      secure.accounting.branch_id === device.branch_id &&
      secure.accounting.terminal_id === device.terminal_id
    ) {
      accountingContext = secure.accounting
    } else if (secure.accounting) {
      await bold.secure_set_accounting(null)
    }

    return {
      device,
      session,
      accountingContext,
      user: session?.user || null,
      offline: !!session && !navigator.onLine,
    }
  },

  enroll: async (
    enrollmentCode: string,
    terminal: {
      device_id: string
      terminal_name: string
      app_version: string
    },
  ) => {
    let response: Response

    try {
      response = await fetchWithTimeout(`${API}/terminals/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify({
          enrollment_code: enrollmentCode.trim().toUpperCase(),
          device_id: terminal.device_id,
          name: terminal.terminal_name,
          app_version: terminal.app_version,
        }),
      })
    } catch {
      throw networkError(
        'يجب الاتصال بالخادم لتسجيل هذا الجهاز للمرة الأولى.',
      )
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
    accountingContext = null
    await bold.secure_set_device(device)
    return device
  },

  login: async (phone: string, password: string) => {
    const normalizedPhone = phone.trim().replace(/\s+/g, '')
    let response: Response

    try {
      response = await fetchWithTimeout(`${API}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify({ phone: normalizedPhone, password }),
      })
    } catch {
      throw networkError('أول تسجيل دخول للكاشير يتطلب اتصالاً بالخادم.')
    }

    if (!response.ok) throw await parseError(response)

    const value: Session = await response.json()

    if (!['branch_manager', 'cashier'].includes(value.user.role)) {
      throw new ApiError({
        code: 'POS_ROLE_DENIED',
        message_ar: 'استخدم حساب كاشير أو مدير فرع في نقطة البيع.',
      })
    }

    if (!value.user.branch_id) {
      throw new ApiError({
        code: 'USER_BRANCH_REQUIRED',
        message_ar: 'يجب ربط حساب الكاشير بفرع من لوحة الإدارة.',
      })
    }

    if (!device || value.user.branch_id !== device.branch_id) {
      throw new ApiError({
        code: 'USER_BRANCH_MISMATCH',
        message_ar: 'حساب الكاشير تابع لفرع مختلف عن هذا الجهاز.',
      })
    }

    await clearAccountingContext()
    await saveSession(value)
    return value
  },

  logout: async () => {
    const refreshToken = session?.refresh_token

    if (refreshToken) {
      await fetchWithTimeout(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => undefined)
    }

    await clearSession()
  },

  search: (q: string, branchId?: string) =>
    request<any[]>(
      `/products/search?q=${encodeURIComponent(q)}${
        branchId ? `&branch_id=${branchId}` : ''
      }`,
    ),

  sale: (payload: any) =>
    request<any>('/pos/sale', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  pricing: (variantId: string) =>
    request<any>('/pricing/calculate', {
      method: 'POST',
      body: JSON.stringify({ variant_id: variantId }),
    }),

  customerLookup: (phone: string) =>
    request<any>(`/customers/lookup?phone=${encodeURIComponent(phone)}`),

  customerLoyalty: (phone: string) =>
    request<any>(`/customers/loyalty?phone=${encodeURIComponent(phone)}`),

  customers: (q: string) =>
    request<any[]>(`/customers?q=${encodeURIComponent(q)}`),

  createCustomer: (payload: any) =>
    request<any>('/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listSales: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value))
    })
    return request<{
      items: Invoice[]
      total: number
      total_pages: number
    }>(`/sales?${query.toString()}`)
  },

  getSale: (id: string) =>
    request<Invoice>(`/sales/${encodeURIComponent(id)}`),

  invoiceLookup: (reference: string) =>
    request<any>(
      `/pos/invoices/lookup?reference=${encodeURIComponent(reference)}`,
    ),

  returnSale: (payload: any) =>
    request<any>('/pos/return', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  currentShift: (branchId: string) =>
    request<Shift | null>(
      `/shifts/current?branch_id=${encodeURIComponent(branchId)}`,
    ),

  offlineContextFor: (shift: Pick<Shift, 'id' | 'branch_id'>) =>
    currentContextMatches(accountingContext, shift)
      ? accountingContext
      : null,

  ensureOfflineAccountingContext: async (
    shift: Pick<Shift, 'id' | 'branch_id'>,
  ) => {
    const refreshBeforeMs = 15 * 60 * 1000
    if (currentContextMatches(accountingContext, shift, refreshBeforeMs)) {
      return accountingContext!
    }
    if (!session || !device) {
      throw new ApiError({
        code: 'OFFLINE_ACCOUNTING_IDENTITY_REQUIRED',
        message_ar: 'يجب تسجيل دخول الكاشير وتسجيل الجهاز قبل تجهيز وضع البيع دون اتصال.',
      })
    }

    const issued = await request<OfflineAccountingContext>(
      `/shifts/${encodeURIComponent(shift.id)}/offline-context`,
      { method: 'POST' },
    )
    if (!offlineAccountingContextMatches(issued, { session, device, shift })) {
      throw new ApiError({
        code: 'OFFLINE_ACCOUNTING_CONTEXT_INVALID',
        message_ar: 'أعاد الخادم تفويضًا لا يطابق الكاشير أو الجهاز أو الوردية الحالية.',
      })
    }
    await bold.secure_set_accounting(issued)
    accountingContext = issued
    return issued
  },

  clearOfflineAccountingContext: clearAccountingContext,

  openShift: (branchId: string, openingCash: number) =>
    request<Shift>('/shifts/open', {
      method: 'POST',
      body: JSON.stringify({
        branch_id: branchId,
        opening_cash: openingCash,
      }),
    }),

  closeShift: (id: string, closingCash: number) =>
    request<Shift>(`/shifts/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      body: JSON.stringify({ closing_cash: closingCash }),
    }),

  pull: (branchId: string, cursor?: string | null) =>
    request<any>(
      `/sync/pull?branch_id=${encodeURIComponent(branchId)}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      }`,
    ),

  heartbeat: (payload: any) =>
    request<any>('/terminals/heartbeat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listReturns: (
    params: Record<string, string | number | undefined>,
  ) => {
    const query = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        query.set(key, String(value))
      }
    })

    return request<{
      items: ReturnRecord[]
      total: number
      total_pages: number
    }>(`/returns?${query.toString()}`)
  },
}
