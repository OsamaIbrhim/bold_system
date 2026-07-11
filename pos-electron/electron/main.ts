import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
// @ts-ignore
import initSqlJs from 'sql.js'

let SQL: any
let db: any
let win: BrowserWindow

function dbPath() { return path.join(app.getPath('userData'), 'bold_pos.sqlite') }
function saveDb() { try { const data = db.export(); fs.writeFileSync(dbPath(), Buffer.from(data)) } catch {} }

function q(sql: string, params: any[] = []) { const stmt = db.prepare(sql); stmt.bind(params); const rows: any[] = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows }
function get(sql: string, params: any[] = []) { const stmt = db.prepare(sql); stmt.bind(params); const r = stmt.step() ? stmt.getAsObject() : undefined; stmt.free(); return r }
function run(sql: string, params: any[] = []) { const stmt = db.prepare(sql); stmt.bind(params); stmt.step(); stmt.free(); }

async function initDb() {
  const wasmPath = app.isPackaged ? path.join(process.resourcesPath, 'sql-wasm.wasm') : path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ locateFile: () => wasmPath })
  const file = dbPath()
  db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database()
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT, name_en TEXT, barcode_ean13 TEXT, barcode_internal TEXT, size TEXT, color TEXT, cost_price REAL, selling_price REAL);
    CREATE TABLE IF NOT EXISTS stock (variant_id TEXT PRIMARY KEY, qty INTEGER);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, type TEXT, payload TEXT, sync_status TEXT DEFAULT 'pending', created_at TEXT);
    CREATE TABLE IF NOT EXISTS sales_local (sync_id TEXT PRIMARY KEY, invoice_number TEXT, total REAL, created_at TEXT);
  `)
  saveDb()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 768,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  if (process.env.VITE_DEV_SERVER_URL) { win.loadURL(process.env.VITE_DEV_SERVER_URL); win.webContents.openDevTools() }
  else { win.loadFile(path.join(__dirname, '../dist/index.html')) }
}
app.whenReady().then(async () => { await initDb(); createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.handle('pos:search', (_e, qstr: string) => q(`SELECT * FROM products WHERE barcode_ean13 = ? OR barcode_internal = ? OR sku LIKE ? LIMIT 20`, [qstr, qstr, `%${qstr}%`]))
ipcMain.handle('pos:stock', (_e, variant_id: string) => get(`SELECT qty FROM stock WHERE variant_id = ?`, [variant_id])?.qty || 0)
ipcMain.handle('pos:sale', (_e, sale: any) => {
  const sync_id = sale.sync_id || require('crypto').randomUUID()
  run(`INSERT OR IGNORE INTO sales_local (sync_id, invoice_number, total, created_at) VALUES (?,?,?,?)`, [sync_id, sale.invoice_number || 'LOCAL-'+Date.now(), sale.total||0, new Date().toISOString()])
  run(`INSERT OR REPLACE INTO outbox (id, type, payload, sync_status, created_at) VALUES (?,?,?,?,?)`, [sync_id, 'sale', JSON.stringify({...sale, sync_id}), 'pending', new Date().toISOString()])
  for (const it of sale.items||[]) { run(`UPDATE stock SET qty = qty - ? WHERE variant_id = ?`, [it.qty, it.variant_id]) }
  saveDb(); return { sync_id, ok: true }
})
ipcMain.handle('sync:get_outbox', () => q(`SELECT * FROM outbox WHERE sync_status='pending'`))
ipcMain.handle('sync:mark_sent', (_e, ids: string[]) => { for (const id of ids) run(`UPDATE outbox SET sync_status='sent' WHERE id = ?`, [id]); saveDb(); return { ok: true }})
ipcMain.handle('sync:apply_pull', (_e, data: any) => {
  for (const p of data.products||[]) run(`INSERT OR REPLACE INTO products (id,sku,name_en,barcode_ean13,barcode_internal,size,color,cost_price,selling_price) VALUES (?,?,?,?,?,?,?,?,?)`, [p.id, p.sku, p.product?.name_en||'', p.barcode_ean13||null, p.barcode_internal||null, p.size||null, p.color||null, Number(p.cost_price||0), 0])
  for (const s of data.stock||[]) run(`INSERT OR REPLACE INTO stock (variant_id, qty) VALUES (?,?)`, [s.variant_id, s.qty_on_hand||0])
  saveDb(); return { ok: true }
})

// ESC/POS Thermal Receipt – 80mm – HTML print, no native modules
// Cash drawer kick: most thermal printers kick the drawer automatically on print – enable in Windows printer preferences "Cash drawer: Open before printing"
// Software kick fallback: ESC p 0 25 250
ipcMain.handle('pos:print', async (_e, invoice: any, lang: 'ar'|'en' = 'ar') => {
  const isAr = lang === 'ar'
  const itemsHtml = (invoice.items || []).map((it:any) => `
    <tr><td>${it.name || it.sku}</td><td>${it.qty}</td><td>${it.unit_price}</td><td>${(it.unit_price*it.qty).toFixed(0)}</td></tr>
  `).join('')
  const html = `<!doctype html><html lang="${isAr?'ar':'en'}" dir="${isAr?'rtl':'ltr'}"><head><meta charset="utf-8">
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    body { font-family: 'Cairo', Arial, sans-serif; width: 72mm; margin:0; font-size: 12px; }
    h2 { text-align:center; margin:4px 0; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:2px 0; font-size:11px; }
    th { border-bottom:1px dashed #000; }
    .totals { margin-top:6px; border-top:1px dashed #000; padding-top:4px; }
    .center { text-align:center; }
    .small { font-size:10px; }
  </style></head><body>
  <h2>Bold</h2>
  <div class="center small">ملابس رجالي – Men's Clothing<br/>${isAr ? 'فاتورة' : 'Invoice'} ${invoice.invoice_number || ''}<br/>${new Date().toLocaleString(isAr?'ar-EG':'en-GB')}</div>
  <hr>
  <table><thead><tr><th>${isAr?'الصنف':'Item'}</th><th>${isAr?'ك':'Q'}</th><th>${isAr?'السعر':'Price'}</th><th>${isAr?'الإجمالي':'Total'}</th></tr></thead>
  <tbody>${itemsHtml}</tbody></table>
  <div class="totals">
    ${isAr ? 'الإجمالي' : 'Total'}: <b>${invoice.total || 0} ${isAr ? 'ج' : 'EGP'}</b><br>
    <span class="small">${isAr ? 'شامل الضريبة 14%' : 'VAT 14% included'}</span>
  </div>
  <hr>
  <div class="center small">${isAr ? 'سياسة الإرجاع: 14 يوم بحالة الشراء الأصلية' : 'Returns: 14 days original condition'}<br>شكراً لتسوقكم في Bold – Thank you</div>
  <script>window.onload = () => { window.print(); setTimeout(()=>window.close(), 500) }</script>
  </body></html>`
  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false }})
  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  printWin.webContents.print({ silent: false, printBackground: false }, (success) => {
    if (!success) console.log('Print cancelled')
    printWin.close()
  })
  // Cash drawer kick – if printer is configured to kick on print, hardware does it automatically.
  // Software fallback (ESC/POS): 0x1b 0x70 0x00 0x19 0xfa – would need raw USB – omitted for no-native build.
  // For now: log it – enable "Cash Drawer – Open before printing" in Windows Printer Preferences.
  console.log('[CASH DRAWER] Kick – enable "Open cash drawer before printing" in your 80mm printer driver')
  return { ok: true, printed: true }
})
