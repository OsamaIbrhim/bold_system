import { randomUUID } from 'node:crypto'
import process from 'node:process'

const api = process.env.PERF_API_URL || 'http://localhost:3000/api/v1'
const smoke =
  process.env.PERF_SMOKE === '1' || process.argv.includes('--smoke')

function numericEnv(name, fallback, minimum = 0) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be a number >= ${minimum}`)
  return value
}

const concurrency = numericEnv('PERF_CONCURRENCY', smoke ? 2 : 25, 1)
const requestsPerWorker = numericEnv('PERF_REQUESTS_PER_WORKER', smoke ? 3 : 20, 1)
const p95Budget = numericEnv('PERF_READ_P95_MS', smoke ? 1000 : 300, 1)
const allowedErrorRate = numericEnv('PERF_ERROR_RATE', 0.005, 0)
const timeoutMs = numericEnv('PERF_REQUEST_TIMEOUT_MS', 15_000, 100)
const warmupRequests = numericEnv('PERF_WARMUP_REQUESTS', smoke ? 1 : 3, 0)
const failures = []

class RequestFailure extends Error {
  constructor(message, details = {}) {
    super(message)
    this.details = details
  }
}

function addFailure(code, message, details = {}) {
  failures.push({ code, message, ...details })
}

function parseBody(text) {
  if (!text) return {}
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 500) } }
}

function requestHeaders(init = {}) {
  return { 'x-request-id': `perf-${randomUUID()}`, ...(init.headers || {}) }
}

function serverDuration(response) {
  const match = /(?:^|,)\s*app;dur=([0-9.]+)/i.exec(response.headers.get('server-timing') || '')
  return match ? Number(match[1]) : null
}

async function timedJson(path, init = {}) {
  const started = performance.now()
  let response
  try {
    response = await fetch(`${api}${path}`, {
      ...init,
      headers: requestHeaders(init),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new RequestFailure(`${init.method || 'GET'} ${path}: ${error.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : error.message}`, {
      path, method: init.method || 'GET', timeout_ms: timeoutMs,
    })
  }
  const text = await response.text()
  const body = parseBody(text)
  const clientMs = performance.now() - started
  if (!response.ok) {
    throw new RequestFailure(`${init.method || 'GET'} ${path}: HTTP ${response.status}`, {
      path, status: response.status, request_id: body.request_id || response.headers.get('x-request-id'), body,
    })
  }
  return { body, response, clientMs, serverMs: serverDuration(response) }
}

async function json(path, init = {}) {
  return (await timedJson(path, init)).body
}

async function authenticate() {
  if (process.env.PERF_ACCESS_TOKEN) return process.env.PERF_ACCESS_TOKEN
  const phone = process.env.PERF_LOGIN_PHONE
  const password = process.env.PERF_LOGIN_PASSWORD
  if (!phone || !password) throw new Error('Set PERF_ACCESS_TOKEN or PERF_LOGIN_PHONE and PERF_LOGIN_PASSWORD')
  const result = await json('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }),
  })
  return result.access_token
}

function percentile(values, value) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] || 0
}

function roundedPercentiles(values) {
  return {
    p50_ms: Math.round(percentile(values, 0.50)),
    p95_ms: Math.round(percentile(values, 0.95)),
    p99_ms: Math.round(percentile(values, 0.99)),
  }
}

async function oneMeasuredRequest(path, token) {
  const started = performance.now()
  try {
    const response = await fetch(`${api}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-request-id': `perf-${randomUUID()}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const bytes = await response.arrayBuffer()
    const clientMs = performance.now() - started
    const serverMs = serverDuration(response)
    let responseError
    let responseRequestId = response.headers.get('x-request-id')
    if (!response.ok) {
      const body = parseBody(new TextDecoder().decode(bytes))
      responseRequestId = body.request_id || responseRequestId
      responseError = `HTTP ${response.status}${body.code ? ` ${body.code}` : ''}${body.message ? `: ${body.message}` : ''}`
    }
    return {
      ok: response.ok,
      status: response.status,
      clientMs,
      serverMs,
      waitMs: serverMs === null ? null : Math.max(0, clientMs - serverMs),
      requestId: responseRequestId,
      error: responseError,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      clientMs: performance.now() - started,
      serverMs: null,
      waitMs: null,
      error: error.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : error.message,
    }
  }
}

async function loadEndpoint(path, token, options = {}) {
  const workers = options.concurrency ?? concurrency
  const perWorker = options.requestsPerWorker ?? requestsPerWorker
  const enforce = options.enforce !== false
  const warmups = options.warmups ?? warmupRequests

  for (let index = 0; index < warmups; index += 1) await oneMeasuredRequest(path, token)

  const samples = []
  const wallStarted = performance.now()
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let index = 0; index < perWorker; index += 1) samples.push(await oneMeasuredRequest(path, token))
  }))
  const wallMs = performance.now() - wallStarted
  const errors = samples.filter((sample) => !sample.ok)
  const client = samples.map((sample) => sample.clientMs)
  const server = samples.filter((sample) => sample.serverMs !== null).map((sample) => sample.serverMs)
  const waiting = samples.filter((sample) => sample.waitMs !== null).map((sample) => sample.waitMs)
  const errorRate = samples.length ? errors.length / samples.length : 1
  const clientStats = roundedPercentiles(client)
  const result = {
    type: options.type || 'load',
    path,
    requests: samples.length,
    concurrency: workers,
    errors: errors.length,
    error_rate: Number(errorRate.toFixed(4)),
    throughput_rps: Number((samples.length / (wallMs / 1000)).toFixed(1)),
    ...clientStats,
    server_p95_ms: server.length ? Math.round(percentile(server, 0.95)) : null,
    outside_server_p95_ms: waiting.length ? Math.round(percentile(waiting, 0.95)) : null,
    server_timing_coverage: Number((server.length / Math.max(1, samples.length)).toFixed(3)),
    error_samples: errors.slice(0, 3).map(({ status, error, requestId }) => ({ status, error, request_id: requestId })),
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)

  if (enforce && errorRate > allowedErrorRate) {
    addFailure('ERROR_RATE_EXCEEDED', `${path} error rate ${errorRate} exceeds ${allowedErrorRate}`, { path, result })
  }
  if (enforce && clientStats.p95_ms > p95Budget) {
    addFailure('READ_P95_EXCEEDED', `${path} p95 ${clientStats.p95_ms}ms exceeds ${p95Budget}ms`, {
      path,
      diagnosis: result.server_p95_ms === null
        ? 'Server-Timing is missing; rebuild/restart the API from this revision.'
        : result.outside_server_p95_ms > result.server_p95_ms
          ? 'Most latency is outside the Nest handler: inspect HTTP/socket queues and client/server host load.'
          : 'Most latency is inside the API: inspect database pool waits, query plans, and slow-request logs.',
      result,
    })
  }
  return result
}

async function mutationIntegrityLoad(adminToken) {
  if (process.env.PERF_MUTATIONS !== '1') return null
  const { PrismaClient, Prisma } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const salesCount = numericEnv('PERF_SALES', 100, 1)
    const saleBudget = numericEnv('PERF_SALE_P95_MS', 500, 1)
    const cashier = await json('/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        phone:process.env.PERF_CASHIER_PHONE || '+200100000002',
        password:process.env.PERF_CASHIER_PASSWORD || 'Bold1234',
      }),
    })
    const branchId = cashier.user.branch_id
    if (!branchId) throw new Error('Performance cashier must be assigned to a branch')
    const enrollment = await json('/terminals/enrollment-codes', {
      method:'POST', headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({branch_id:branchId,name:'Performance terminal'}),
    })
    const deviceId = randomUUID()
    const enrolled = await json('/terminals/enroll', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({enrollment_code:enrollment.enrollment_code,device_id:deviceId,name:'Performance terminal',app_version:'perf'}),
    })
    const posHeaders = {
      Authorization:`Bearer ${cashier.access_token}`,
      'Content-Type':'application/json',
      'x-pos-device-id':deviceId,
      'x-pos-device-token':enrolled.device_token,
    }
    const stockBefore = await prisma.inventoryStock.findFirst({
      where:{branch_id:branchId,qty_on_hand:{gte:salesCount + 10}}, include:{variant:true},
    })
    if (!stockBefore) throw new Error(`No variant has at least ${salesCount + 10} units for the mutation load`)

    const commands = Array.from({length:salesCount},()=>({
      sync_id:randomUUID(), branch_id:branchId, payment_method:'cash', language:'ar',
      items:[{variant_id:stockBefore.variant_id,qty:1}],
    }))
    const latencies = []
    let next = 0
    const workers = Math.min(concurrency, salesCount)
    await Promise.all(Array.from({length:workers},async()=>{
      while(true){
        const index=next++
        if(index>=commands.length)return
        const started=performance.now()
        await json('/pos/sale',{
          method:'POST', headers:{...posHeaders,'x-request-id':`perf-sale-${randomUUID()}`},
          body:JSON.stringify(commands[index]),
        })
        latencies.push(performance.now()-started)
      }
    }))

    await json('/pos/sale',{ method:'POST',headers:posHeaders,body:JSON.stringify(commands[0]) })
    const invoices = await prisma.salesInvoice.findMany({
      where:{sync_id:{in:commands.map(command=>command.sync_id)}}, include:{items:true},
    })
    if(invoices.length!==salesCount)throw new Error(`Expected ${salesCount} unique invoices, found ${invoices.length}`)
    for(const invoice of invoices){
      const subtotal=invoice.items.reduce((sum,item)=>sum.plus(new Prisma.Decimal(item.unit_price).mul(item.qty)),new Prisma.Decimal(0)).toDecimalPlaces(2)
      const tax=invoice.items.reduce((sum,item)=>sum.plus(new Prisma.Decimal(item.unit_tax).mul(item.qty)),new Prisma.Decimal(0)).toDecimalPlaces(2)
      if(!subtotal.equals(invoice.subtotal)||!tax.equals(invoice.tax_amount)||!subtotal.plus(tax).equals(invoice.total)){
        throw new Error(`Financial invariant failed for invoice ${invoice.invoice_number}`)
      }
    }
    const stockAfter=await prisma.inventoryStock.findUnique({where:{branch_id_variant_id:{branch_id:branchId,variant_id:stockBefore.variant_id}}})
    if(!stockAfter||stockAfter.qty_on_hand!==stockBefore.qty_on_hand-salesCount||stockAfter.qty_on_hand<0){
      throw new Error(`Stock invariant failed: before ${stockBefore.qty_on_hand}, after ${stockAfter?.qty_on_hand}`)
    }
    const result={
      type:'mutation',suite:'concurrent-sales-integrity',sales:salesCount,duplicate_retries:1,
      p95_ms:Math.round(percentile(latencies,0.95)),p99_ms:Math.round(percentile(latencies,0.99)),
      stock_before:stockBefore.qty_on_hand,stock_after:stockAfter.qty_on_hand,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if(result.p95_ms>saleBudget) addFailure('SALE_P95_EXCEEDED', `Sale p95 ${result.p95_ms}ms exceeds ${saleBudget}ms`, { result })
    return result
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  process.stdout.write(JSON.stringify({
    type:'configuration', suite:smoke?'hard-smoke':'hard-load', api, concurrency,
    requests_per_worker:requestsPerWorker, timeout_ms:timeoutMs, warmup_requests:warmupRequests,
    thresholds:{read_p95_ms:p95Budget,error_rate:allowedErrorRate},
    runtime:{node:process.version,platform:process.platform,arch:process.arch},
  })+'\n')

  const token = await authenticate()
  const headers = { Authorization: `Bearer ${token}` }
  const [branchesResult, productResult, salesResult] = await Promise.allSettled([
    json('/branches', { headers }),
    json('/products?page=1&page_size=1', { headers }),
    json('/sales?page=1&page_size=1', { headers }),
  ])
  for (const [path, result] of [
    ['/branches', branchesResult],
    ['/products?page=1&page_size=1', productResult],
    ['/sales?page=1&page_size=1', salesResult],
  ]) {
    if (result.status === 'rejected') {
      addFailure('PREFLIGHT_REQUEST_FAILED', result.reason.message, { path, ...(result.reason.details || {}) })
    }
  }
  const branches = branchesResult.status === 'fulfilled' ? branchesResult.value : []
  const branchId = process.env.PERF_BRANCH_ID || branches[0]?.id
  if (!branchId) addFailure('PERF_BRANCH_MISSING', 'No branch is available for synchronization checks. Set PERF_BRANCH_ID or create an active branch.')
  const dataset = {
    products: productResult.status === 'fulfilled' ? Number(productResult.value.total || 0) : null,
    invoices: salesResult.status === 'fulfilled' ? Number(salesResult.value.total || 0) : null,
  }
  process.stdout.write(JSON.stringify({type:'preflight',dataset})+'\n')
  if (!smoke && process.env.PERF_REQUIRE_VOLUME !== '0' && dataset.products !== null && dataset.invoices !== null) {
    const minProducts = numericEnv('PERF_MIN_PRODUCTS', process.env.PERF_PRODUCTS || 10_000, 1)
    const minInvoices = numericEnv('PERF_MIN_INVOICES', process.env.PERF_INVOICES || 50_000, 1)
    if (dataset.products < minProducts || dataset.invoices < minInvoices) {
      addFailure('DATASET_TOO_SMALL', `Full hard test requires at least ${minProducts} products and ${minInvoices} invoices. Run npm run perf:seed against bold_perf first.`, {
        expected:{products:minProducts,invoices:minInvoices},actual:dataset,
      })
    }
  }

  await loadEndpoint('/auth/me', token, {type:'baseline',concurrency:1,requestsPerWorker:Math.min(10,requestsPerWorker),enforce:false,warmups:1})
  await loadEndpoint('/products?page=1&page_size=20', token, {type:'baseline',concurrency:1,requestsPerWorker:Math.min(10,requestsPerWorker),enforce:false,warmups:1})

  let snapshot
  if (branchId) try {
    const measured = await timedJson(`/sync/pull?branch_id=${encodeURIComponent(branchId)}`, { headers })
    snapshot = measured.body
    const result = {
      type:'snapshot',path:'/sync/pull initial snapshot',duration_ms:Math.round(measured.clientMs),
      server_ms:measured.serverMs===null?null:Math.round(measured.serverMs),products:snapshot.products?.length||0,
      cursor_type:typeof snapshot.cursor,
    }
    process.stdout.write(JSON.stringify(result)+'\n')
    if (typeof snapshot.cursor !== 'string') addFailure('SYNC_CURSOR_CONTRACT', 'Sync cursor must be a JSON string.', { result })
    const snapshotBudget = numericEnv('PERF_SNAPSHOT_MAX_MS', smoke ? 5000 : 10_000, 1)
    if (result.duration_ms > snapshotBudget) addFailure('SNAPSHOT_BUDGET_EXCEEDED', `Initial snapshot ${result.duration_ms}ms exceeds ${snapshotBudget}ms`, { result })
  } catch (error) {
    addFailure('SNAPSHOT_FAILED', error.message, error.details || {})
  }

  const endpoints = [
    '/products?page=1&page_size=20',
    '/products?page=500&page_size=20',
    '/sales?page=1&page_size=20',
    '/sales?page=500&page_size=20',
  ]
  if (snapshot?.cursor) endpoints.push(`/sync/pull?branch_id=${encodeURIComponent(branchId)}&cursor=${encodeURIComponent(snapshot.cursor)}`)
  for (const endpoint of endpoints) await loadEndpoint(endpoint, token)

  try { await mutationIntegrityLoad(token) }
  catch (error) { addFailure('MUTATION_SUITE_FAILED', error.message, error.details || {}) }

  const summary = {
    type:'summary',ok:failures.length===0,suite:smoke?'hard-smoke':'hard-load',failures,
    note:failures.length?'All scenarios completed; fix every listed failure before release.':'All hard-test gates passed.',
  }
  process.stdout.write(JSON.stringify(summary)+'\n')
  if (failures.length) process.exitCode=1
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({type:'fatal',ok:false,message:error.message,details:error.details||{}})+'\n')
  process.exitCode=1
})
