import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import {
  isValidOfflineAccountingContext,
  maxTerminalSequence,
  nextTerminalSequence,
  offlineAccountingContextMatches,
  OfflineAccountingContext,
  toOfflineAccountingSummary,
} from './offline-accounting'
import {
  SIGNED_CATALOG_FORMAT_VERSION,
  isValidCatalogStock,
  isValidSignedCatalogProduct,
  requiresFullCatalogRefresh,
} from './catalog-format'
import { assertAllowedApiRequest } from './api-policy'
import { validateLocalSaleInput } from './sale-validation'
import {
  publicDevice,
  sanitizeBootstrapState,
} from './secure-public'
import {
  createOfflineLoginVerifier,
  normalizeLoginPhone,
  OfflineLoginVerifier,
  verifyOfflineLogin,
} from './offline-login'
import {
  HeldSaleScope,
  parseHeldSaleItems,
  sanitizeHeldSaleCustomer,
  validateHeldSaleItems,
} from './held-sale'
import {
  formatMoney,
  fromCents,
  lineCents,
  sameMoney,
  toCents,
} from './money'
// @ts-ignore
import initSqlJs from 'sql.js'

let SQL: any
let db: any
let win: BrowserWindow

function dbPath() {
  return path.join(app.getPath('userData'), 'bold_pos.sqlite')
}

function secureStatePath() {
  return path.join(app.getPath('userData'), 'secure-state.bin')
}

function saveDb() {
  const data = db.export()
  const target = dbPath()
  const temporary = `${target}.tmp`
  try {
    fs.writeFileSync(temporary, Buffer.from(data), { mode: 0o600 })
    fs.renameSync(temporary, target)
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    } catch {}
    throw error
  }
}

type AuthenticatedSession = {
  access_token: string
  refresh_token: string
  user: {
    id: string
    name: string
    role: 'branch_manager' | 'cashier'
    branch_id: string
  }
}

type PersistedAuth = {
  session: AuthenticatedSession
  offline_valid_until: string
}

type SecureState = {
  auth?: PersistedAuth
  device?: {
    device_id: string
    device_token: string
    branch_id: string
    terminal_id: string
    terminal_code: string
  }
  accounting?: OfflineAccountingContext
  offline_login?: OfflineLoginVerifier
}

type ApiFailure = {
  message: string
  code: string
  field?: string
  request_id?: string
  status?: number
  details?: string[]
}

type RefreshResult = 'refreshed' | 'rejected' | 'network_error'

const API_BASE =
  process.env.BOLD_API_URL ||
  (app.isPackaged
    ? 'https://boldsystem-production.up.railway.app/api/v1'
    : 'http://localhost:3000/api/v1')
const API_TIMEOUT_MS = 15_000
let refreshPromise: Promise<RefreshResult> | null = null


function highestStoredSaleSequence() {
  return String(
    get(
      `SELECT terminal_sequence
       FROM sales_local
       WHERE terminal_sequence IS NOT NULL
         AND terminal_sequence <> ''
       ORDER BY LENGTH(terminal_sequence) DESC, terminal_sequence DESC
       LIMIT 1`,
    )?.terminal_sequence || '0',
  )
}

function alignLocalSequence(context?: OfflineAccountingContext | null) {
  if (!context || !isValidOfflineAccountingContext(context)) return
  setMeta(
    'terminal_sale_sequence',
    maxTerminalSequence(
      getMeta('terminal_sale_sequence'),
      context.server_last_sale_sequence,
    ),
  )
}

function updateSecureAcknowledgedSequence(sequence: string) {
  try {
    const state = readSecureState()
    if (!state.accounting || !isValidOfflineAccountingContext(state.accounting)) {
      return
    }
    state.accounting.server_last_sale_sequence = maxTerminalSequence(
      state.accounting.server_last_sale_sequence,
      sequence,
    )
    writeSecureState(state)
  } catch {
    // The SQLite sequence remains authoritative for this installation. The
    // secure copy is updated on a best-effort basis to help recovery after a
    // local database restore.
  }
}

function readSecureState(): SecureState {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(secureStatePath())) return {}
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(secureStatePath())))
  } catch {
    return {}
  }
}

function writeSecureState(state: SecureState) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this computer')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(state))
  const temporary = `${secureStatePath()}.tmp`
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 })
  fs.renameSync(temporary, secureStatePath())
}

function publicBootstrapState() {
  // Every application start must require a cashier login. Existing secure
  // credentials remain available only to the main process for validated
  // online refresh or offline password verification.
  return sanitizeBootstrapState(readSecureState())
}

function apiFailure(error: any): ApiFailure {
  return {
    message:
      error?.message ||
      'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.',
    code: error?.code || 'UNKNOWN_ERROR',
    field: error?.field,
    request_id: error?.request_id,
    status: error?.status,
    details: Array.isArray(error?.details)
      ? error.details.map(String)
      : undefined,
  }
}

function envelope<T>(operation: () => T | Promise<T>) {
  return Promise.resolve()
    .then(operation)
    .then((data) => ({ ok: true as const, data }))
    .catch((error) => ({
      ok: false as const,
      error: apiFailure(error),
    }))
}

async function fetchWithTimeout(
  pathname: string,
  init: RequestInit = {},
) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    API_TIMEOUT_MS,
  )
  try {
    return await fetch(`${API_BASE}${pathname}`, {
      ...init,
      signal: controller.signal,
    })
  } catch {
    throw {
      message:
        'لا يمكن الوصول إلى الخادم. تحقق من الإنترنت أو عنوان الخادم.',
      code: 'NETWORK_ERROR',
    } satisfies ApiFailure
  } finally {
    clearTimeout(timer)
  }
}

async function parseApiFailure(response: Response) {
  const payload = await response.json().catch(() => ({}))
  throw {
    message:
      payload.message_ar ||
      payload.message ||
      'تعذر تنفيذ الطلب.',
    code:
      payload.code ||
      `HTTP_${response.status}`,
    field: payload.field,
    request_id: payload.request_id,
    status: response.status,
    details: Array.isArray(payload.details)
      ? payload.details.map(String)
      : undefined,
  } satisfies ApiFailure
}

async function readJson(response: Response) {
  if (response.status === 204) return null
  return response.json()
}

function saveAuthenticatedSession(session: AuthenticatedSession) {
  const state = readSecureState()
  state.auth = {
    session,
    offline_valid_until: new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString(),
  }
  writeSecureState(state)
}

function clearSessionState() {
  const state = readSecureState()
  delete state.auth
  delete state.accounting
  delete state.offline_login
  writeSecureState(state)
}

function clearDeviceState() {
  const state = readSecureState()
  delete state.device
  delete state.auth
  delete state.accounting
  delete state.offline_login
  writeSecureState(state)
}

function offlineCashierLogin(
  phone: string,
  password: string,
) {
  const state = readSecureState()
  const auth = state.auth
  const device = state.device
  const context = state.accounting
  const offlineUntil = Date.parse(
    String(auth?.offline_valid_until || ''),
  )

  if (
    !auth?.session?.user ||
    !device ||
    !context ||
    !Number.isFinite(offlineUntil) ||
    offlineUntil <= Date.now() ||
    !verifyOfflineLogin(
      state.offline_login,
      phone,
      password,
    ) ||
    !offlineAccountingContextMatches(
      context,
      {
        session: {
          user: auth.session.user,
        },
        device,
        shift: {
          id: context.shift_id,
          branch_id: context.branch_id,
        },
      },
    )
  ) {
    throw {
      message:
        'لا يمكن تسجيل الدخول دون اتصال بهذه البيانات. اتصل بالخادم لتجديد جلسة الكاشير وتفويض الوردية.',
      code: 'OFFLINE_LOGIN_UNAVAILABLE',
    } satisfies ApiFailure
  }

  return {
    session: { user: auth.session.user },
    accounting:
      toOfflineAccountingSummary(context),
    offline: true,
  }
}

async function refreshSession(): Promise<RefreshResult> {
  const refreshToken =
    readSecureState().auth?.session?.refresh_token
  if (!refreshToken) return 'rejected'

  if (!refreshPromise) {
    refreshPromise = (async () => {
      let response: Response
      try {
        response = await fetchWithTimeout('/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': randomUUID(),
          },
          body: JSON.stringify({
            refresh_token: refreshToken,
          }),
        })
      } catch {
        return 'network_error' as const
      }

      if (!response.ok) return 'rejected' as const
      saveAuthenticatedSession(
        (await readJson(response)) as AuthenticatedSession,
      )
      return 'refreshed' as const
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

async function authenticatedFetch(
  pathname: string,
  input: {
    method?: string
    body?: unknown
  } = {},
  retry = true,
): Promise<any> {
  const state = readSecureState()
  const response = await fetchWithTimeout(pathname, {
    method: input.method || 'GET',
    headers: {
      ...(input.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(state.auth?.session?.access_token
        ? {
            Authorization:
              `Bearer ${state.auth.session.access_token}`,
          }
        : {}),
      ...(state.device?.device_token
        ? {
            'x-pos-device-token':
              state.device.device_token,
          }
        : {}),
      ...(state.device?.device_id
        ? {
            'x-pos-device-id': state.device.device_id,
          }
        : {}),
      'x-request-id': randomUUID(),
    },
    body:
      input.body !== undefined
        ? JSON.stringify(input.body)
        : undefined,
  })

  if (response.status === 401 && retry) {
    const refresh = await refreshSession()
    if (refresh === 'refreshed') {
      return authenticatedFetch(pathname, input, false)
    }
    if (refresh === 'network_error') {
      throw {
        message:
          'انقطع الاتصال أثناء تجديد الجلسة. لم يتم حذف تسجيل الجهاز أو بيانات الدخول.',
        code: 'NETWORK_ERROR',
      } satisfies ApiFailure
    }
  }

  if (!response.ok) await parseApiFailure(response)
  return readJson(response)
}

function persistedMutation<T>(operation: () => T): T {
  const before = db.export()
  let transactionOpen = false
  try {
    db.exec('BEGIN IMMEDIATE TRANSACTION')
    transactionOpen = true
    const result = operation()
    db.exec('COMMIT')
    transactionOpen = false
    saveDb()
    return result
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec('ROLLBACK')
      } catch {}
    }
    try {
      db.close()
    } catch {}
    db = new SQL.Database(before)
    throw error
  }
}

function q(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const rows: any[] = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally {
    stmt.free()
  }
}

function get(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    return stmt.step() ? stmt.getAsObject() : undefined
  } finally {
    stmt.free()
  }
}

function run(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    stmt.step()
  } finally {
    stmt.free()
  }
}

function setMeta(key: string, value: string) {
  run(`INSERT OR REPLACE INTO sync_meta (key,value) VALUES (?,?)`, [key, value])
}

function getMeta(key: string) {
  return String(get(`SELECT value FROM sync_meta WHERE key=?`, [key])?.value || '')
}

function currentHeldSaleScope(): HeldSaleScope {
  const state = readSecureState()
  const user = state.auth?.session?.user
  const device = state.device
  const context = state.accounting
  if (
    !user ||
    !device ||
    !context ||
    context.user_id !== user.id ||
    context.branch_id !== user.branch_id ||
    context.branch_id !== device.branch_id ||
    context.terminal_id !== device.terminal_id ||
    !context.shift_id
  ) {
    throw new Error(
      'لا يمكن الوصول إلى الفواتير المعلقة قبل تسجيل الكاشير وتجهيز الوردية على هذا الجهاز.',
    )
  }
  return {
    branch_id: context.branch_id,
    cashier_id: context.user_id,
    shift_id: context.shift_id,
  }
}

function parseHeldCustomer(value: unknown) {
  if (!value) return null
  try {
    return sanitizeHeldSaleCustomer(
      JSON.parse(String(value)),
    )
  } catch {
    throw new Error(
      'بيانات عميل الفاتورة المعلقة تالفة. احذف المسودة وأعد إنشاءها.',
    )
  }
}

function hydrateHeldSale(row: any) {
  const storedItems = parseHeldSaleItems(
    row.items_json,
  )
  const items = storedItems.map((stored) => {
    const product = get(
      `SELECT p.*,COALESCE(s.qty,0) AS available_qty
       FROM products p
       LEFT JOIN stock s ON s.variant_id=p.id
       WHERE p.id=?`,
      [stored.variant_id],
    )
    const available = Number(
      product?.available_qty,
    )
    const price = Number(
      product?.selling_price,
    )
    const tax = Number(product?.unit_tax)
    if (
      !product ||
      !isValidSignedCatalogProduct(product) ||
      !Number.isInteger(available) ||
      available < stored.qty ||
      price <= 0
    ) {
      throw new Error(
        `الصنف ${stored.variant_id} تغير أو لم تعد كميته كافية. احذف المسودة أو أعد بناءها من الكتالوج الحالي.`,
      )
    }
    return {
      ...product,
      id: String(product.id),
      variant_id: String(product.id),
      name:
        String(
          product.name_ar ||
          product.name_en ||
          product.sku ||
          product.id,
        ),
      qty: stored.qty,
      unit_price: price,
      unit_tax: tax,
      available_qty: available,
    }
  })
  const totalCents = items.reduce(
    (sum, item) =>
      sum +
      lineCents(item.unit_price, item.qty) +
      lineCents(item.unit_tax, item.qty),
    0,
  )
  return {
    id: String(row.id),
    customer: parseHeldCustomer(
      row.customer_json,
    ),
    items,
    item_count: items.reduce(
      (sum, item) => sum + item.qty,
      0,
    ),
    total: fromCents(totalCents),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    resume_error: null,
  }
}

function summarizeHeldSale(row: any) {
  try {
    return hydrateHeldSale(row)
  } catch (error) {
    let itemCount = 0
    try {
      itemCount = parseHeldSaleItems(
        row.items_json,
      ).reduce(
        (sum, item) => sum + item.qty,
        0,
      )
    } catch {}
    let customer = null
    try {
      customer = parseHeldCustomer(
        row.customer_json,
      )
    } catch {}
    return {
      id: String(row.id),
      customer,
      items: [],
      item_count: itemCount,
      total: 0,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      resume_error:
        error instanceof Error
          ? error.message
          : 'تعذر استعادة الفاتورة المعلقة.',
    }
  }
}

function heldSaleRows(scope: HeldSaleScope) {
  return q(
    `SELECT *
     FROM held_sales
     WHERE branch_id=?
       AND cashier_id=?
       AND shift_id=?
     ORDER BY created_at DESC
     LIMIT 50`,
    [
      scope.branch_id,
      scope.cashier_id,
      scope.shift_id,
    ],
  )
}

function hasUnsignedCatalogProducts() {
  return !!get(
    `SELECT 1 AS found
     FROM products
     WHERE COALESCE(price_version,'')=''
        OR COALESCE(price_token,'')=''
        OR COALESCE(price_issued_at,'')=''
     LIMIT 1`,
  )?.found
}

function catalogNeedsFullRefresh() {
  return requiresFullCatalogRefresh(
    getMeta('catalog_format_version'),
    hasUnsignedCatalogProducts() ? 1 : 0,
  )
}

function requireFullCatalogRefresh() {
  setMeta('catalog_format_version', '')
  setMeta('sync_cursor', '')
  setMeta('catalog_valid_until', '')
}

async function initDb() {
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sql-wasm.wasm')
    : path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ locateFile: () => wasmPath })
  const file = dbPath()
  db = fs.existsSync(file)
    ? new SQL.Database(fs.readFileSync(file))
    : new SQL.Database()
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT,
      name_en TEXT,
      name_ar TEXT,
      barcode_ean13 TEXT,
      barcode_internal TEXT,
      size TEXT,
      color TEXT,
      cost_price REAL,
      selling_price REAL,
      unit_tax REAL DEFAULT 0,
      price_version TEXT,
      price_token TEXT,
      price_issued_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stock (
      variant_id TEXT PRIMARY KEY,
      qty INTEGER
    );
    CREATE TABLE IF NOT EXISTS sellers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      type TEXT,
      payload TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT,
      attempt_count INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      last_error TEXT,
      server_document_id TEXT,
      server_document_number TEXT,
      terminal_sequence TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sales_local (
      sync_id TEXT PRIMARY KEY,
      invoice_number TEXT,
      total REAL,
      created_at TEXT,
      occurred_at TEXT,
      payment_method TEXT,
      customer_phone TEXT,
      cashier_id TEXT,
      seller_id TEXT,
      shift_id TEXT,
      offline_session_id TEXT,
      terminal_sequence TEXT,
      server_invoice_id TEXT,
      server_invoice_number TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS held_sales (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      shift_id TEXT NOT NULL,
      customer_json TEXT,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS held_sales_scope_created_idx
      ON held_sales (
        branch_id,
        cashier_id,
        shift_id,
        created_at DESC
      );
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  // Forward-compatible migrations for databases created by older releases.
  for (const migration of [
    `ALTER TABLE products ADD COLUMN unit_tax REAL DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN name_ar TEXT`,
    `ALTER TABLE products ADD COLUMN price_version TEXT`,
    `ALTER TABLE products ADD COLUMN price_token TEXT`,
    `ALTER TABLE products ADD COLUMN price_issued_at TEXT`,
    `ALTER TABLE sales_local ADD COLUMN payment_method TEXT`,
    `ALTER TABLE sales_local ADD COLUMN customer_phone TEXT`,
    `ALTER TABLE sales_local ADD COLUMN server_invoice_id TEXT`,
    `ALTER TABLE sales_local ADD COLUMN server_invoice_number TEXT`,
    `ALTER TABLE sales_local ADD COLUMN synced_at TEXT`,
    `ALTER TABLE sales_local ADD COLUMN occurred_at TEXT`,
    `ALTER TABLE sales_local ADD COLUMN cashier_id TEXT`,
    `ALTER TABLE sales_local ADD COLUMN seller_id TEXT`,
    `ALTER TABLE sales_local ADD COLUMN shift_id TEXT`,
    `ALTER TABLE sales_local ADD COLUMN offline_session_id TEXT`,
    `ALTER TABLE sales_local ADD COLUMN terminal_sequence TEXT`,
    `ALTER TABLE outbox ADD COLUMN attempt_count INTEGER DEFAULT 0`,
    `ALTER TABLE outbox ADD COLUMN last_attempt_at TEXT`,
    `ALTER TABLE outbox ADD COLUMN last_error TEXT`,
    `ALTER TABLE outbox ADD COLUMN server_document_id TEXT`,
    `ALTER TABLE outbox ADD COLUMN server_document_number TEXT`,
    `ALTER TABLE outbox ADD COLUMN terminal_sequence TEXT`,
    `ALTER TABLE outbox ADD COLUMN updated_at TEXT`,
  ]) {
    try { db.exec(migration) } catch {}
  }

  // A crash can leave an operation marked as sending after the server has
  // accepted it. Retrying with the same sync_id is safe because sale creation
  // is idempotent on the backend.
  run(
    `UPDATE outbox SET sync_status='pending',updated_at=? WHERE sync_status='sending'`,
    [new Date().toISOString()],
  )

  if (!getMeta('device_id')) setMeta('device_id', randomUUID())
  if (!getMeta('terminal_name')) setMeta('terminal_name', os.hostname() || 'Bold POS')
  if (!getMeta('sync_status')) setMeta('sync_status', 'never')
  setMeta(
    'terminal_sale_sequence',
    maxTerminalSequence(
      getMeta('terminal_sale_sequence'),
      highestStoredSaleSequence(),
    ),
  )
  alignLocalSequence(readSecureState().accounting)

  // Databases created before signed price snapshots already contain products,
  // but those rows do not have price_version/price_token. Keeping the old
  // cursor would make the server return an empty delta forever. Force exactly
  // one complete snapshot and only mark the new catalog format after that
  // snapshot is validated and committed atomically.
  if (catalogNeedsFullRefresh()) {
    requireFullCatalogRefresh()
  }

  saveDb()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }))
  win.webContents.on('will-navigate', (event, url) => {
    const allowed =
      (!app.isPackaged &&
        !!process.env.VITE_DEV_SERVER_URL &&
        url.startsWith(process.env.VITE_DEV_SERVER_URL)) ||
      (app.isPackaged && url.startsWith('file:'))
    if (!allowed) event.preventDefault()
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => { await initDb(); createWindow() })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle(
  'api:bootstrap',
  () => envelope(() => publicBootstrapState()),
)

ipcMain.handle(
  'api:enroll',
  (_event, enrollmentCode: string, terminal: any) =>
    envelope(async () => {
      const code = String(enrollmentCode || '')
        .trim()
        .toUpperCase()
      const deviceId = String(terminal?.device_id || '')
      const terminalName = String(
        terminal?.terminal_name || '',
      ).trim()
      const appVersion = String(
        terminal?.app_version || '',
      ).trim()
      if (
        code.length !== 12 ||
        !deviceId ||
        !terminalName ||
        !appVersion
      ) {
        throw {
          message: 'بيانات تسجيل الجهاز غير مكتملة.',
          code: 'TERMINAL_ENROLLMENT_INPUT_INVALID',
        } satisfies ApiFailure
      }

      const response = await fetchWithTimeout(
        '/terminals/enroll',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': randomUUID(),
          },
          body: JSON.stringify({
            enrollment_code: code,
            device_id: deviceId,
            name: terminalName,
            app_version: appVersion,
          }),
        },
      )
      if (!response.ok) await parseApiFailure(response)
      const result = await readJson(response)
      const enrolled = {
        device_id: deviceId,
        device_token: String(result?.device_token || ''),
        branch_id: String(
          result?.terminal?.branch?.id || '',
        ),
        terminal_id: String(result?.terminal?.id || ''),
        terminal_code: String(
          result?.terminal?.terminal_code || '',
        ),
      }
      if (
        !enrolled.device_token ||
        !enrolled.branch_id ||
        !enrolled.terminal_id ||
        !enrolled.terminal_code
      ) {
        throw {
          message:
            'أعاد الخادم بيانات تسجيل جهاز غير مكتملة.',
          code: 'TERMINAL_ENROLLMENT_RESPONSE_INVALID',
        } satisfies ApiFailure
      }

      const state = readSecureState()
      if (
        state.device?.terminal_id !==
        enrolled.terminal_id
      ) {
        delete state.auth
        delete state.accounting
        delete state.offline_login
      }
      state.device = enrolled
      writeSecureState(state)
      return publicDevice(enrolled)
    }),
)

ipcMain.handle(
  'api:login',
  (_event, phone: string, password: string) =>
    envelope(async () => {
      const normalizedPhone =
        normalizeLoginPhone(phone)
      if (!normalizedPhone || String(password || '').length < 8) {
        throw {
          message: 'أدخل رقم الهاتف وكلمة المرور الصحيحين.',
          code: 'POS_LOGIN_INPUT_INVALID',
        } satisfies ApiFailure
      }

      let response: Response
      try {
        response = await fetchWithTimeout(
          '/auth/login',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': randomUUID(),
            },
            body: JSON.stringify({
              phone: normalizedPhone,
              password,
            }),
          },
        )
      } catch (error: any) {
        if (error?.code === 'NETWORK_ERROR') {
          return offlineCashierLogin(
            normalizedPhone,
            password,
          )
        }
        throw error
      }
      if (!response.ok) await parseApiFailure(response)
      const value =
        (await readJson(response)) as AuthenticatedSession
      const state = readSecureState()

      if (
        !value?.access_token ||
        !value?.refresh_token ||
        !value?.user?.id
      ) {
        throw {
          message:
            'أعاد الخادم جلسة دخول غير مكتملة.',
          code: 'POS_LOGIN_RESPONSE_INVALID',
        } satisfies ApiFailure
      }
      if (
        !['branch_manager', 'cashier'].includes(
          value.user.role,
        )
      ) {
        throw {
          message:
            'استخدم حساب كاشير أو مدير فرع في نقطة البيع.',
          code: 'POS_ROLE_DENIED',
        } satisfies ApiFailure
      }
      if (!value.user.branch_id) {
        throw {
          message:
            'يجب ربط حساب الكاشير بفرع من لوحة الإدارة.',
          code: 'USER_BRANCH_REQUIRED',
        } satisfies ApiFailure
      }
      if (
        !state.device ||
        value.user.branch_id !== state.device.branch_id
      ) {
        throw {
          message:
            'حساب الكاشير تابع لفرع مختلف عن هذا الجهاز.',
          code: 'USER_BRANCH_MISMATCH',
        } satisfies ApiFailure
      }

      delete state.accounting
      state.auth = {
        session: value,
        offline_valid_until: new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString(),
      }
      state.offline_login =
        createOfflineLoginVerifier(
          normalizedPhone,
          password,
        )
      writeSecureState(state)
      return {
        session: { user: value.user },
        accounting: null,
        offline: false,
      }
    }),
)

ipcMain.handle(
  'api:logout',
  () =>
    envelope(async () => {
      const refreshToken =
        readSecureState().auth?.session?.refresh_token
      if (refreshToken) {
        await fetchWithTimeout('/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': randomUUID(),
          },
          body: JSON.stringify({
            refresh_token: refreshToken,
          }),
        }).catch(() => undefined)
      }
      clearSessionState()
      return { cleared: true }
    }),
)

ipcMain.handle(
  'api:request',
  (_event, input: any) =>
    envelope(async () => {
      const request = assertAllowedApiRequest(
        input?.path,
        input?.method,
      )
      const result = await authenticatedFetch(
        request.pathname,
        {
          method: request.method,
          body: input?.body,
        },
      )

      if (request.pathname === '/auth/me') {
        const state = readSecureState()
        if (state.auth?.session && result?.id) {
          saveAuthenticatedSession({
            ...state.auth.session,
            user: {
              ...state.auth.session.user,
              ...result,
            },
          })
        }
      }
      return result
    }),
)

ipcMain.handle(
  'api:clear_session',
  () =>
    envelope(() => {
      clearSessionState()
      return { cleared: true }
    }),
)

ipcMain.handle(
  'api:clear_device',
  () =>
    envelope(() => {
      clearDeviceState()
      return { cleared: true }
    }),
)

ipcMain.handle(
  'api:clear_accounting',
  () =>
    envelope(() => {
      const state = readSecureState()
      delete state.accounting
      writeSecureState(state)
      return { cleared: true }
    }),
)

ipcMain.handle(
  'api:issue_accounting',
  (_event, shiftId: string) =>
    envelope(async () => {
      const normalizedShiftId = String(
        shiftId || '',
      ).trim()
      if (!normalizedShiftId) {
        throw {
          message: 'هوية الوردية مطلوبة.',
          code: 'SHIFT_ID_REQUIRED',
        } satisfies ApiFailure
      }
      const context =
        (await authenticatedFetch(
          `/shifts/${encodeURIComponent(normalizedShiftId)}/offline-context`,
          { method: 'POST' },
        )) as OfflineAccountingContext
      const state = readSecureState()
      const user = state.auth?.session?.user
      const device = state.device
      if (
        !user ||
        !device ||
        !offlineAccountingContextMatches(
          context,
          {
            session: { user },
            device,
            shift: {
              id: normalizedShiftId,
              branch_id: user.branch_id,
            },
          },
        )
      ) {
        throw {
          message:
            'أعاد الخادم تفويضًا لا يطابق الكاشير أو الجهاز أو الوردية الحالية.',
          code: 'OFFLINE_ACCOUNTING_CONTEXT_INVALID',
        } satisfies ApiFailure
      }

      persistedMutation(() => {
        alignLocalSequence(context)
      })
      state.accounting = context
      writeSecureState(state)
      return toOfflineAccountingSummary(context)
    }),
)

ipcMain.handle('pos:search', (_e, qstr: string) => {
  const term = String(qstr || '').trim()
  if (!term) return []
  return q(
    `SELECT p.*, COALESCE(s.qty,0) AS qty FROM products p LEFT JOIN stock s ON s.variant_id=p.id WHERE p.barcode_ean13=? OR p.barcode_internal=? OR p.sku LIKE ? OR p.name_ar LIKE ? OR p.name_en LIKE ? ORDER BY CASE WHEN p.barcode_ean13=? OR p.barcode_internal=? THEN 0 ELSE 1 END,p.sku LIMIT 40`,
    [term, term, `%${term}%`, `%${term}%`, `%${term}%`, term, term],
  )
})

ipcMain.handle('pos:stock', (_e, variantId: string) =>
  Number(get(`SELECT qty FROM stock WHERE variant_id=?`, [variantId])?.qty || 0),
)

ipcMain.handle('pos:list_sellers', () =>
  q(`SELECT id,name FROM sellers ORDER BY name,id`),
)

ipcMain.handle('pos:list_local_sales', () =>
  q(
    `SELECT
       s.sync_id,
       s.invoice_number AS local_invoice_number,
       COALESCE(s.server_invoice_number,s.invoice_number) AS invoice_number,
       s.server_invoice_id,
       s.server_invoice_number,
       s.synced_at,
       s.total,
       s.created_at,
       COALESCE(s.occurred_at,s.created_at) AS occurred_at,
       s.payment_method,
       s.customer_phone,
       s.cashier_id,
       s.seller_id,
       s.shift_id,
       s.offline_session_id,
       s.terminal_sequence,
       COALESCE(o.sync_status,'sent') AS sync_status,
       COALESCE(o.attempt_count,0) AS attempt_count,
       o.last_attempt_at,
       o.last_error
     FROM sales_local s
     LEFT JOIN outbox o ON o.id=s.sync_id
     ORDER BY COALESCE(s.occurred_at,s.created_at) DESC
     LIMIT 100`,
  ),
)

ipcMain.handle('pos:list_held_sales', () => {
  const scope = currentHeldSaleScope()
  return heldSaleRows(scope).map(
    summarizeHeldSale,
  )
})

ipcMain.handle('pos:hold_sale', (_event, input: any) => {
  const scope = currentHeldSaleScope()
  const items = validateHeldSaleItems(
    input?.items,
  )
  const customer =
    sanitizeHeldSaleCustomer(
      input?.customer,
    )
  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    ...scope,
    customer_json: customer
      ? JSON.stringify(customer)
      : null,
    items_json: JSON.stringify(items),
    created_at: now,
    updated_at: now,
  }

  // Hydration ignores renderer-supplied prices and reads the current signed
  // catalog and stock before accepting the draft.
  const hydrated = hydrateHeldSale(row)
  return persistedMutation(() => {
    run(
      `INSERT INTO held_sales (
        id,branch_id,cashier_id,shift_id,
        customer_json,items_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        row.id,
        row.branch_id,
        row.cashier_id,
        row.shift_id,
        row.customer_json,
        row.items_json,
        row.created_at,
        row.updated_at,
      ],
    )
    const stale = q(
      `SELECT id
       FROM held_sales
       WHERE branch_id=?
         AND cashier_id=?
         AND shift_id=?
       ORDER BY created_at DESC
       LIMIT -1 OFFSET 50`,
      [
        scope.branch_id,
        scope.cashier_id,
        scope.shift_id,
      ],
    )
    for (const draft of stale) {
      run(
        `DELETE FROM held_sales
         WHERE id=?
           AND branch_id=?
           AND cashier_id=?
           AND shift_id=?`,
        [
          draft.id,
          scope.branch_id,
          scope.cashier_id,
          scope.shift_id,
        ],
      )
    }
    return hydrated
  })
})

ipcMain.handle(
  'pos:resume_held_sale',
  (_event, id: string) => {
    const scope = currentHeldSaleScope()
    const row = get(
      `SELECT *
       FROM held_sales
       WHERE id=?
         AND branch_id=?
         AND cashier_id=?
         AND shift_id=?`,
      [
        String(id || ''),
        scope.branch_id,
        scope.cashier_id,
        scope.shift_id,
      ],
    )
    if (!row) {
      throw new Error(
        'الفاتورة المعلقة غير موجودة في وردية هذا الكاشير.',
      )
    }
    const hydrated = hydrateHeldSale(row)
    return persistedMutation(() => {
      run(
        `DELETE FROM held_sales
         WHERE id=?
           AND branch_id=?
           AND cashier_id=?
           AND shift_id=?`,
        [
          row.id,
          scope.branch_id,
          scope.cashier_id,
          scope.shift_id,
        ],
      )
      return hydrated
    })
  },
)

ipcMain.handle(
  'pos:delete_held_sale',
  (_event, id: string) => {
    const scope = currentHeldSaleScope()
    return persistedMutation(() => {
      run(
        `DELETE FROM held_sales
         WHERE id=?
           AND branch_id=?
           AND cashier_id=?
           AND shift_id=?`,
        [
          String(id || ''),
          scope.branch_id,
          scope.cashier_id,
          scope.shift_id,
        ],
      )
      return {
        ok: db.getRowsModified() === 1,
      }
    })
  },
)

ipcMain.handle('pos:sale', (_e, sale: any) => {
  const secure = readSecureState()
  const authSession = secure.auth?.session
  const context = secure.accounting
  const device = secure.device
  if (!device) {
    throw new Error(
      'This POS terminal is not enrolled',
    )
  }

  const validated = validateLocalSaleInput(
    sale,
    device.branch_id,
  )
  const {
    syncId,
    items,
    localTotal,
    paymentMethod,
    customerPhone,
    sellerId,
    language,
  } = validated
  const seller = get(
    `SELECT id FROM sellers WHERE id=?`,
    [sellerId],
  )
  if (!seller) {
    throw new Error(
      'البائع المحدد غير موجود في قائمة الفرع المحلية. نفّذ مزامنة واختر البائع مرة أخرى.',
    )
  }
  const existing = get(
    `SELECT sync_id,invoice_number,total,terminal_sequence,
            COALESCE(occurred_at,created_at) AS occurred_at
     FROM sales_local
     WHERE sync_id=?`,
    [syncId],
  )
  if (existing) return { ...existing, ok: true, replayed: true }

  const shift = context
    ? { id: context.shift_id, branch_id: context.branch_id }
    : null
  if (
    !authSession?.user ||
    !device ||
    !shift ||
    !offlineAccountingContextMatches(
      context,
      {
        session: { user: authSession.user as any },
        device,
        shift,
      },
    )
  ) {
    throw new Error(
      'Offline accounting authorization is missing, expired, or does not match the current cashier, terminal, and shift',
    )
  }

  const calculatedTotalCents = items.reduce(
    (sum: number, item: any) =>
      sum +
      lineCents(item.unit_price, item.qty) +
      lineCents(item.unit_tax, item.qty),
    0,
  )
  if (
    toCents(localTotal) < 0 ||
    !sameMoney(localTotal, fromCents(calculatedTotalCents))
  ) {
    throw new Error('Sale total does not match the immutable local price snapshots')
  }
  const occurredAt = new Date().toISOString()
  const terminalSequence = nextTerminalSequence(
    getMeta('terminal_sale_sequence'),
    context.server_last_sale_sequence,
  )
  const invoiceNumber =
    `LOCAL-${device.terminal_code}-${terminalSequence}`
  const command = {
    sync_id: syncId,
    branch_id: device.branch_id,
    shift_id: context.shift_id,
    origin_cashier_id: context.user_id,
    seller_id: sellerId,
    offline_session_id: context.session_id,
    terminal_sequence: terminalSequence,
    occurred_at: occurredAt,
    offline_accounting_token: context.token,
    customer_phone: customerPhone,
    items,
    payment_method: paymentMethod,
    language,
  }

  return persistedMutation(() => {
    for (const item of items) {
      run(
        `UPDATE stock SET qty=qty-? WHERE variant_id=? AND qty>=?`,
        [item.qty, item.variant_id, item.qty],
      )
      if (db.getRowsModified() !== 1) {
        throw new Error(`Insufficient local stock for ${item.variant_id}`)
      }
    }
    run(
      `INSERT INTO sales_local (
        sync_id,invoice_number,total,created_at,occurred_at,payment_method,
        customer_phone,cashier_id,seller_id,shift_id,offline_session_id,terminal_sequence
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        syncId,
        invoiceNumber,
        localTotal,
        occurredAt,
        occurredAt,
        command.payment_method,
        command.customer_phone || null,
        context.user_id,
        sellerId,
        context.shift_id,
        context.session_id,
        terminalSequence,
      ],
    )
    run(
      `INSERT INTO outbox (
        id,type,payload,sync_status,created_at,terminal_sequence,updated_at
      ) VALUES (?,?,?,?,?,?,?)`,
      [
        syncId,
        'sale',
        JSON.stringify(command),
        'pending',
        occurredAt,
        terminalSequence,
        occurredAt,
      ],
    )
    setMeta('terminal_sale_sequence', terminalSequence)
    return {
      sync_id: syncId,
      invoice_number: invoiceNumber,
      terminal_sequence: terminalSequence,
      occurred_at: occurredAt,
      ok: true,
    }
  })
})

ipcMain.handle('sync:get_outbox', () =>
  q(`SELECT o.*,s.total AS local_total
     FROM outbox o
     LEFT JOIN sales_local s ON s.sync_id=o.id
     WHERE o.sync_status='pending'
     ORDER BY
       CASE WHEN o.terminal_sequence IS NULL THEN 0 ELSE 1 END,
       LENGTH(COALESCE(o.terminal_sequence,'')),
       o.terminal_sequence,
       o.created_at`),
)

ipcMain.handle('sync:mark_sending', (_e, id: string) => {
  return persistedMutation(() => {
    const now = new Date().toISOString()
    run(
      `UPDATE outbox
       SET sync_status='sending',
           attempt_count=COALESCE(attempt_count,0)+1,
           last_attempt_at=?,
           last_error=NULL,
           updated_at=?
       WHERE id=? AND sync_status='pending'`,
      [now, now, id],
    )
    if (db.getRowsModified() !== 1) {
      throw new Error(
        `Outbox operation is not pending: ${id}`,
      )
    }
    return { ok: true }
  })
})

ipcMain.handle('sync:mark_sent', (_e, result: {
  id: string,
  server_document_id?: string | null,
  server_document_number?: string | null,
}) => {
  const now = new Date().toISOString()
  const terminalSequence = String(
    get(`SELECT terminal_sequence FROM outbox WHERE id=?`, [result.id])?.terminal_sequence || '',
  )
  const persisted = persistedMutation(() => {
    run(
      `UPDATE outbox
       SET sync_status='sent',
           server_document_id=?,
           server_document_number=?,
           last_error=NULL,
           updated_at=?
       WHERE id=?`,
      [
        result.server_document_id || null,
        result.server_document_number || null,
        now,
        result.id,
      ],
    )
    run(
      `UPDATE sales_local
       SET server_invoice_id=?,
           server_invoice_number=?,
           synced_at=?
       WHERE sync_id=?`,
      [
        result.server_document_id || null,
        result.server_document_number || null,
        now,
        result.id,
      ],
    )
    return { ok: true }
  })
  if (terminalSequence) {
    updateSecureAcknowledgedSequence(terminalSequence)
  }
  return persisted
})

ipcMain.handle('sync:mark_failed', (_e, input: {
  id: string,
  error: string,
  retryable: boolean,
}) => {
  return persistedMutation(() => {
    const now = new Date().toISOString()
    run(
      `UPDATE outbox
       SET sync_status=?,
           last_error=?,
           updated_at=?
       WHERE id=?`,
      [
        input.retryable ? 'pending' : 'failed',
        String(
          input.error ||
          'Unknown synchronization error',
        ).slice(0, 1000),
        now,
        input.id,
      ],
    )
    return { ok: true }
  })
})

ipcMain.handle('sync:get_status', () => {
  const catalogRefreshRequired = catalogNeedsFullRefresh()

  return {
    device_id: getMeta('device_id'),
    terminal_name: getMeta('terminal_name'),
    app_version: app.getVersion(),
    sync_status: getMeta('sync_status') || 'never',
    last_sync_at: getMeta('last_sync_at') || null,
    last_error: getMeta('last_error') || null,
    pending_count: Number(
      get(`SELECT COUNT(*) AS count FROM outbox WHERE sync_status IN ('pending','sending','failed')`)?.count || 0,
    ),
    terminal_sale_sequence: getMeta('terminal_sale_sequence') || '0',
    // Returning a null cursor makes the next normal sync request a full
    // snapshot. This also self-heals a partially corrupted local catalog.
    sync_cursor: catalogRefreshRequired
      ? null
      : getMeta('sync_cursor') || null,
    catalog_valid_until: catalogRefreshRequired
      ? null
      : getMeta('catalog_valid_until') || null,
  }
})

ipcMain.handle('sync:set_status', (_e, status: any) => {
  return persistedMutation(() => {
    if (status.sync_status) {
      setMeta(
        'sync_status',
        String(status.sync_status),
      )
    }
    if (status.last_sync_at) {
      setMeta(
        'last_sync_at',
        String(status.last_sync_at),
      )
    }
    if ('catalog_valid_until' in status) {
      setMeta(
        'catalog_valid_until',
        status.catalog_valid_until
          ? String(status.catalog_valid_until)
          : '',
      )
    }
    setMeta(
      'last_error',
      status.last_error
        ? String(status.last_error).slice(0, 500)
        : '',
    )
    return { ok: true }
  })
})

ipcMain.handle('sync:apply_pull', (_e, data: any) => {
  const products = Array.isArray(data?.products) ? data.products : []
  const stock = Array.isArray(data?.stock) ? data.stock : []
  const sellers = Array.isArray(data?.sellers) ? data.sellers : []
  const refreshRequired = catalogNeedsFullRefresh()

  // Never advance an old cursor while the local database still requires the
  // signed catalog format. A complete reset response is mandatory.
  if (refreshRequired && !data?.reset_products) {
    throw new Error(
      'A complete signed catalog snapshot is required before delta synchronization',
    )
  }

  // Validate complete snapshots and deltas before changing the currently
  // usable catalog. A malformed server response must leave the old database
  // and cursor intact.
  if (
    products.some(
      (product: any) =>
        !isValidSignedCatalogProduct(product),
    )
  ) {
    throw new Error(
      'The server returned a catalog containing an invalid signed price snapshot',
    )
  }
  if (
    stock.some(
      (entry: any) => !isValidCatalogStock(entry),
    )
  ) {
    throw new Error(
      'The server returned invalid branch stock data',
    )
  }
  if (
    sellers.some(
      (seller: any) =>
        !/^[0-9a-f-]{36}$/i.test(String(seller?.id || '')) ||
        !String(seller?.name || '').trim(),
    )
  ) {
    throw new Error(
      'The server returned invalid branch seller data',
    )
  }

  return persistedMutation(() => {
    if (data.reset_products) db.exec('DELETE FROM products')
    if (data.reset_stock) db.exec('DELETE FROM stock')
    if (data.reset_sellers) db.exec('DELETE FROM sellers')
    for (const id of data.deleted_variant_ids || []) {
      run(`DELETE FROM products WHERE id=?`, [id])
      run(`DELETE FROM stock WHERE variant_id=?`, [id])
    }
    for (const p of products) {
      run(
        `INSERT OR REPLACE INTO products (id,sku,name_en,name_ar,barcode_ean13,barcode_internal,size,color,cost_price,selling_price,unit_tax,price_version,price_token,price_issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          p.id, p.sku, p.name_en || '', p.name_ar || '',
          p.barcode_ean13 || null, p.barcode_internal || null,
          p.size || null, p.color || null, 0,
          Number(p.selling_price || 0), Number(p.unit_tax || 0),
          p.price_version || null, p.price_token || null, p.price_issued_at || null,
        ],
      )
    }
    for (const s of stock) {
      run(`INSERT OR REPLACE INTO stock (variant_id,qty) VALUES (?,?)`, [
        s.variant_id,
        Number(s.qty_on_hand),
      ])
    }
    for (const seller of sellers) {
      run(`INSERT OR REPLACE INTO sellers (id,name) VALUES (?,?)`, [
        seller.id,
        String(seller.name).trim(),
      ])
    }
    if (data.reset_products) {
      setMeta('catalog_format_version', SIGNED_CATALOG_FORMAT_VERSION)
    }
    if (data.cursor !== undefined) setMeta('sync_cursor', String(data.cursor))
    if (data.catalog_valid_until !== undefined) setMeta('catalog_valid_until', String(data.catalog_valid_until || ''))
    return { ok: true }
  })
})

ipcMain.handle('pos:print', async (_e, invoice: any, lang: 'ar' | 'en' = 'ar') => {
  const isAr = lang === 'ar'
  const escapeHtml = (value: unknown) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  const itemsHtml = (invoice.items || [])
    .map(
      (item: any) =>
        `<tr><td>${escapeHtml(item.name || item.sku)}</td><td>${Number(item.qty)}</td><td>${formatMoney(item.unit_price || 0)}</td><td>${formatMoney(fromCents(lineCents(item.unit_price || 0, Number(item.qty))))}</td></tr>`,
    )
    .join('')
  const payment = (
    {
      cash: 'نقدي',
      card: 'بطاقة',
      instapay: 'InstaPay',
      vodafone_cash: 'فودافون كاش',
      installment: 'تقسيط',
    } as Record<string, string>
  )[invoice.payment_method] || invoice.payment_method || ''
  const cashInfo =
    invoice.received !== undefined
      ? `<div>${isAr ? 'المستلم' : 'Received'}: ${Number(invoice.received).toFixed(2)}<br>${isAr ? 'الباقي' : 'Change'}: ${Number(invoice.change || 0).toFixed(2)}</div>`
      : ''
  const html = `<!doctype html>
<html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8">
  <style>
    @page{size:80mm auto;margin:2mm}
    body{font-family:Arial,sans-serif;width:72mm;margin:0;font-size:12px}
    h2{text-align:center;margin:4px 0}
    table{width:100%;border-collapse:collapse}
    th,td{padding:2px 0;font-size:11px}
    th{border-bottom:1px dashed #000}
    .totals{margin-top:6px;border-top:1px dashed #000;padding-top:4px}
    .center{text-align:center}
    .small{font-size:10px}
  </style>
</head>
<body>
  <h2>Bold</h2>
  <div class="center small">
    ملابس رجالي – Men's Clothing<br>
    ${isAr ? 'فاتورة' : 'Invoice'} ${escapeHtml(invoice.invoice_number || '')}<br>
    ${new Date(invoice.occurred_at || Date.now()).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}
  </div>
  <hr>
  <table>
    <thead>
      <tr>
        <th>${isAr ? 'الصنف' : 'Item'}</th>
        <th>${isAr ? 'ك' : 'Q'}</th>
        <th>${isAr ? 'السعر' : 'Price'}</th>
        <th>${isAr ? 'الإجمالي' : 'Total'}</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>
  <div class="totals">
    ${isAr ? 'الإجمالي' : 'Total'}: <b>${formatMoney(invoice.total || 0)} ${isAr ? 'ج' : 'EGP'}</b><br>
    ${isAr ? 'الدفع' : 'Payment'}: ${escapeHtml(payment)}${cashInfo}<br>
    <span class="small">${isAr ? 'شامل الضريبة' : 'VAT included'}</span>
  </div>
  <hr>
  <div class="center small">
    ${isAr ? 'سياسة الإرجاع: 14 يوم بحالة الشراء الأصلية' : 'Returns: 14 days original condition'}<br>
    شكراً لتسوقكم في Bold – Thank you
  </div>
</body>
</html>`
  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const result = await new Promise<{ success: boolean, reason?: string }>((resolve) => {
      let settled = false
      const finish = (success: boolean, reason?: string) => {
        if (settled) return
        settled = true
        resolve({ success, reason })
      }
      printWin.once('closed', () => finish(false, 'Print window was closed'))
      printWin.webContents.print({ silent: false, printBackground: false }, (success, reason) =>
        finish(success, reason),
      )
    })
    if (!printWin.isDestroyed()) printWin.destroy()
    if (!result.success) return { ok: false, printed: false, reason: result.reason || 'Print cancelled' }
  } catch (error: any) {
    if (!printWin.isDestroyed()) printWin.destroy()
    return { ok: false, printed: false, reason: error?.message || 'Unable to print' }
  }
  console.log('[CASH DRAWER] Kick through printer driver')
  return { ok: true, printed: true }
})
