import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import {
  SIGNED_CATALOG_FORMAT_VERSION,
  isValidSignedCatalogProduct,
  requiresFullCatalogRefresh,
} from './catalog-format'
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
  fs.writeFileSync(temporary, Buffer.from(data), { mode: 0o600 })
  fs.renameSync(temporary, target)
}
type SecureState = {
  auth?: any,
  device?: {
    device_id: string,
    device_token: string,
    branch_id: string,
    terminal_id: string,
    terminal_code: string,
  },
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
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sales_local (
      sync_id TEXT PRIMARY KEY,
      invoice_number TEXT,
      total REAL,
      created_at TEXT,
      payment_method TEXT,
      customer_phone TEXT,
      server_invoice_id TEXT,
      server_invoice_number TEXT,
      synced_at TEXT
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
    `ALTER TABLE outbox ADD COLUMN attempt_count INTEGER DEFAULT 0`,
    `ALTER TABLE outbox ADD COLUMN last_attempt_at TEXT`,
    `ALTER TABLE outbox ADD COLUMN last_error TEXT`,
    `ALTER TABLE outbox ADD COLUMN server_document_id TEXT`,
    `ALTER TABLE outbox ADD COLUMN server_document_number TEXT`,
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
      sandbox: false,
    },
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
       s.payment_method,
       s.customer_phone,
       COALESCE(o.sync_status,'sent') AS sync_status,
       COALESCE(o.attempt_count,0) AS attempt_count,
       o.last_attempt_at,
       o.last_error
     FROM sales_local s
     LEFT JOIN outbox o ON o.id=s.sync_id
     ORDER BY s.created_at DESC
     LIMIT 100`,
  ),
)

ipcMain.handle('pos:sale', (_e, sale: any) => {
  const syncId = String(sale?.sync_id || randomUUID())
  const existing = get(
    `SELECT sync_id,invoice_number,total FROM sales_local WHERE sync_id=?`,
    [syncId],
  )
  if (existing) return { ...existing, ok: true, replayed: true }
  if (!Array.isArray(sale?.items) || !sale.items.length) {
    throw new Error('Sale must contain at least one item')
  }
  const items = sale.items.map((item: any) => ({
    variant_id: String(item.variant_id || ''),
    qty: Number(item.qty),
    unit_price: Number(item.unit_price),
    unit_tax: Number(item.unit_tax),
    price_version: String(item.price_version || ''),
    price_token: String(item.price_token || ''),
  }))
  if (items.some((item: any) =>
    !item.variant_id ||
    !Number.isInteger(item.qty) ||
    item.qty < 1 ||
    !Number.isFinite(item.unit_price) ||
    item.unit_price <= 0 ||
    !Number.isFinite(item.unit_tax) ||
    item.unit_tax < 0 ||
    !item.price_version ||
    !item.price_token
  )) {
    throw new Error('Sale contains an invalid or unsigned price snapshot')
  }
  const localTotal = Number(sale.local_total || 0)
  if (!Number.isFinite(localTotal) || localTotal < 0) throw new Error('Sale total is invalid')
  const { local_total, ...command } = sale
  const now = new Date().toISOString()
  const invoiceNumber = String(sale.invoice_number || `LOCAL-${Date.now()}`)
  try {
    db.exec('BEGIN IMMEDIATE TRANSACTION')
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
      `INSERT INTO sales_local (sync_id,invoice_number,total,created_at,payment_method,customer_phone) VALUES (?,?,?,?,?,?)`,
      [
        syncId,
        invoiceNumber,
        localTotal,
        now,
        String(sale.payment_method || ''),
        sale.customer_phone || null,
      ],
    )
    run(
      `INSERT INTO outbox (id,type,payload,sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
      [syncId, 'sale', JSON.stringify({ ...command, sync_id: syncId }), 'pending', now, now],
    )
    db.exec('COMMIT')
    saveDb()
    return { sync_id: syncId, invoice_number: invoiceNumber, ok: true }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
})

ipcMain.handle('sync:get_outbox', () =>
  q(`SELECT o.*,s.total AS local_total FROM outbox o LEFT JOIN sales_local s ON s.sync_id=o.id WHERE o.sync_status='pending' ORDER BY o.created_at`),
)

ipcMain.handle('sync:mark_sending', (_e, id: string) => {
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
    throw new Error(`Outbox operation is not pending: ${id}`)
  }
  saveDb()
  return { ok: true }
})

ipcMain.handle('sync:mark_sent', (_e, result: {
  id: string,
  server_document_id?: string | null,
  server_document_number?: string | null,
}) => {
  const now = new Date().toISOString()
  try {
    db.exec('BEGIN IMMEDIATE TRANSACTION')
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
    db.exec('COMMIT')
    saveDb()
    return { ok: true }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
})

ipcMain.handle('sync:mark_failed', (_e, input: {
  id: string,
  error: string,
  retryable: boolean,
}) => {
  const now = new Date().toISOString()
  run(
    `UPDATE outbox
     SET sync_status=?,
         last_error=?,
         updated_at=?
     WHERE id=?`,
    [
      input.retryable ? 'pending' : 'failed',
      String(input.error || 'Unknown synchronization error').slice(0, 1000),
      now,
      input.id,
    ],
  )
  saveDb()
  return { ok: true }
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
  if (status.sync_status) setMeta('sync_status', String(status.sync_status))
  if (status.last_sync_at) setMeta('last_sync_at', String(status.last_sync_at))
  if ('catalog_valid_until' in status) setMeta('catalog_valid_until', status.catalog_valid_until ? String(status.catalog_valid_until) : '')
  setMeta('last_error', status.last_error ? String(status.last_error).slice(0, 500) : '')
  saveDb()
  return { ok: true }
})

ipcMain.handle('secure:get', () => readSecureState())

ipcMain.handle('secure:set_auth', (_e, auth: any) => {
  const state = readSecureState()
  if (auth) state.auth = auth
  else delete state.auth
  writeSecureState(state)
  return { ok: true }
})

ipcMain.handle('secure:set_device', (_e, device: SecureState['device'] | null) => {
  const state = readSecureState()
  if (device) state.device = device
  else delete state.device
  writeSecureState(state)
  return { ok: true }
})

ipcMain.handle('sync:apply_pull', (_e, data: any) => {
  const products = Array.isArray(data?.products) ? data.products : []
  const refreshRequired = catalogNeedsFullRefresh()

  // Never advance an old cursor while the local database still requires the
  // signed catalog format. A complete reset response is mandatory.
  if (refreshRequired && !data?.reset_products) {
    throw new Error(
      'A complete signed catalog snapshot is required before delta synchronization',
    )
  }

  // Validate the entire replacement before deleting the currently usable
  // catalog. A malformed server response must leave the old database intact.
  if (
    data?.reset_products &&
    products.some((product: any) => !isValidSignedCatalogProduct(product))
  ) {
    throw new Error(
      'The server returned a catalog containing an invalid signed price snapshot',
    )
  }

  try {
    db.exec('BEGIN IMMEDIATE TRANSACTION')
    if (data.reset_products) db.exec('DELETE FROM products')
    if (data.reset_stock) db.exec('DELETE FROM stock')
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
    for (const s of data.stock || []) {
      run(`INSERT OR REPLACE INTO stock (variant_id,qty) VALUES (?,?)`, [
        s.variant_id,
        s.qty_on_hand || 0,
      ])
    }
    if (data.reset_products) {
      setMeta('catalog_format_version', SIGNED_CATALOG_FORMAT_VERSION)
    }
    if (data.cursor !== undefined) setMeta('sync_cursor', String(data.cursor))
    if (data.catalog_valid_until !== undefined) setMeta('catalog_valid_until', String(data.catalog_valid_until || ''))
    db.exec('COMMIT')
    saveDb()
    return { ok: true }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
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
        `<tr><td>${escapeHtml(item.name || item.sku)}</td><td>${Number(item.qty)}</td><td>${Number(item.unit_price).toFixed(2)}</td><td>${(Number(item.unit_price) * Number(item.qty)).toFixed(2)}</td></tr>`,
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
    ${new Date().toLocaleString(isAr ? 'ar-EG' : 'en-GB')}
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
    ${isAr ? 'الإجمالي' : 'Total'}: <b>${Number(invoice.total || 0).toFixed(2)} ${isAr ? 'ج' : 'EGP'}</b><br>
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