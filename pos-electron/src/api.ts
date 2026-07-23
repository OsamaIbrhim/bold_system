import {
  DeviceCredential,
  Invoice,
  OfflineAccountingContext,
  ReturnRecord,
  Session,
  Shift,
} from './types'
import {
  isValidOfflineAccountingSummary,
  offlineAccountingSummaryMatches,
} from '../electron/offline-accounting'
import { bold, IpcEnvelope } from './electron'

const TERMINAL_CONFIRMATION_DELAY_MS = 2_000
const TERMINAL_CONFIRMATION_WINDOW_MS = 60_000

const TERMINAL_INVALID_CODES = new Set([
  'TERMINAL_REVOKED',
  'TERMINAL_NOT_ENROLLED',
  'TERMINAL_CREDENTIAL_INVALID',
])

type PersistedAuth = { session: Session; offline_valid_until: string }
type SecureState = {
  auth?: PersistedAuth | null
  device?: DeviceCredential | null
  accounting?: OfflineAccountingContext | null
}
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
    validString(value.branch_id) &&
    validString(value.terminal_id) &&
    validString(value.terminal_code)
  )
}

export function validAuth(value: any): value is PersistedAuth {
  return (
    value?.session &&
    validString(value.session.user?.id) &&
    validString(value.session.user?.branch_id) &&
    Number.isFinite(
      Date.parse(String(value.offline_valid_until || '')),
    )
  )
}

export function validOfflineAccountingContext(
  value: unknown,
  nowMs = Date.now(),
) {
  return isValidOfflineAccountingSummary(value, nowMs)
}

function currentContextMatches(
  context: unknown,
  shift: Pick<Shift, 'id' | 'branch_id'>,
  minimumRemainingMs = 0,
) {
  return !!session && !!device && offlineAccountingSummaryMatches(
    context,
    { session, device, shift },
    Date.now(),
    minimumRemainingMs,
  )
}

async function clearAccountingContext() {
  accountingContext = null
  await bold.api_clear_accounting().catch(() => undefined)
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

function unwrap<T>(result: IpcEnvelope<T>): T {
  if (result.ok) return result.data
  throw new ApiError(result.error, result.error.status)
}

async function clearSession() {
  session = null
  persistedAuth = null
  accountingContext = null
  await bold.api_clear_session().catch(() => undefined)
  window.dispatchEvent(new Event('bold-auth-expired'))
}

async function clearDevice() {
  device = null
  terminalEvidence = null
  accountingContext = null
  await bold.api_clear_device().catch(() => undefined)
  session = null
  persistedAuth = null
  window.dispatchEvent(new Event('bold-auth-expired'))
  window.dispatchEvent(new Event('bold-terminal-invalid'))
}

async function request<T = any>(
  path: string,
  init: {
    method?: string
    body?: unknown
  } = {},
): Promise<T> {
  try {
    const value = unwrap(
      await bold.api_request({
        path,
        method: init.method,
        body: init.body,
      }),
    )
    resetTerminalFailure(path)
    return value as T
  } catch (caught) {
    const error =
      caught instanceof ApiError
        ? caught
        : new ApiError({
            code: 'UNKNOWN_ERROR',
            message: (caught as Error)?.message,
          })
    if (TERMINAL_INVALID_CODES.has(error.code)) {
      if (
        registerTerminalFailure(
          error.code,
          path,
        )
      ) {
        await clearDevice()
      }
      throw error
    }

    if (
      error.status === 401 &&
      !['/auth/me', '/auth/login'].includes(path)
    ) {
      await clearSession()
    }

    throw error
  }
}

export const api = {
  base: 'electron-main',

  bootstrap: async () => {
    for (const key of ['token', 'refresh_token', 'user', 'branch_id']) {
      localStorage.removeItem(key)
    }

    const secure = unwrap(
      await bold.api_bootstrap(),
    ) as SecureState
    device = null
    session = null
    persistedAuth = null
    accountingContext = null

    if (validDevice(secure.device)) device = secure.device
    else if (secure.device) {
      await bold.api_clear_device()
    }

    if (validAuth(secure.auth)) {
      persistedAuth = secure.auth
      session = secure.auth.session

      if (!device || session.user.branch_id !== device.branch_id) {
        await clearSession()
      } else {
        try {
          const user = await request<any>('/auth/me')
          session = {
            user: {
              ...session.user,
              ...user,
            },
          }
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
      await bold.api_clear_session()
    }

    if (
      session &&
      device &&
      secure.accounting &&
      isValidOfflineAccountingSummary(secure.accounting) &&
      secure.accounting.user_id === session.user.id &&
      secure.accounting.role === session.user.role &&
      secure.accounting.branch_id === session.user.branch_id &&
      secure.accounting.branch_id === device.branch_id &&
      secure.accounting.terminal_id === device.terminal_id
    ) {
      accountingContext = secure.accounting
    } else if (secure.accounting) {
      await bold.api_clear_accounting()
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
    const enrolled: DeviceCredential = unwrap(
      await bold.api_enroll(
        enrollmentCode,
        terminal,
      ),
    )
    device = enrolled
    accountingContext = null
    return enrolled
  },

  login: async (phone: string, password: string) => {
    const normalizedPhone = phone.trim().replace(/\s+/g, '')
    const result: {
      session: Session
      accounting: OfflineAccountingContext | null
      offline: boolean
    } = unwrap(
      await bold.api_login(
        normalizedPhone,
        password,
      ),
    )
    const value = result.session

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

    session = value
    accountingContext = result.accounting
    persistedAuth = {
      session: value,
      offline_valid_until: new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
    }
    return value
  },

  logout: async () => {
    unwrap(await bold.api_logout())
    session = null
    persistedAuth = null
    accountingContext = null
    window.dispatchEvent(
      new Event('bold-auth-expired'),
    )
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
      body: payload,
    }),

  pricing: (variantId: string) =>
    request<any>('/pricing/calculate', {
      method: 'POST',
      body: { variant_id: variantId },
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
      body: payload,
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
      body: payload,
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

    const issued = unwrap(
      await bold.api_issue_accounting(
        shift.id,
      ),
    )
    if (!offlineAccountingSummaryMatches(
      issued,
      { session, device, shift },
    )) {
      throw new ApiError({
        code: 'OFFLINE_ACCOUNTING_CONTEXT_INVALID',
        message_ar: 'أعاد الخادم تفويضًا لا يطابق الكاشير أو الجهاز أو الوردية الحالية.',
      })
    }
    accountingContext = issued
    return issued
  },

  clearOfflineAccountingContext: clearAccountingContext,

  openShift: (branchId: string, openingCash: number) =>
    request<Shift>('/shifts/open', {
      method: 'POST',
      body: {
        branch_id: branchId,
        opening_cash: openingCash,
      },
    }),

  closeShift: (id: string, closingCash: number) =>
    request<Shift>(`/shifts/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      body: { closing_cash: closingCash },
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
      body: payload,
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
