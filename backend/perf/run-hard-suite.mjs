import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const smoke = process.argv.includes('--smoke')
const backendDirectory = fileURLToPath(new URL('../', import.meta.url))
const suites = [
  {
    name: 'api-hard-load',
    script: 'perf/hard-load.mjs',
    args: smoke ? ['--smoke'] : [],
  },
  {
    name: 'inventory-ledger',
    script: 'perf/inventory-ledger-smoke.mjs',
    args: [],
  },
  {
    name: 'purchasing-accounting',
    script: 'perf/purchasing-accounting-smoke.mjs',
    args: [],
  },
  {
    name: 'transfer-state',
    script: 'perf/transfer-state-smoke.mjs',
    args: [],
  },
]

function runSuite(suite) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [suite.script, ...suite.args], {
      cwd: backendDirectory,
      env: process.env,
      stdio: 'inherit',
    })

    child.once('error', (error) => {
      resolve({
        name: suite.name,
        ok: false,
        exit_code: null,
        signal: null,
        error: error.message,
      })
    })
    child.once('exit', (code, signal) => {
      resolve({
        name: suite.name,
        ok: code === 0,
        exit_code: code,
        signal,
      })
    })
  })
}

const results = []
for (const suite of suites) {
  process.stdout.write(
    `${JSON.stringify({ type: 'suite_start', suite: suite.name })}\n`,
  )
  const result = await runSuite(suite)
  results.push(result)
  process.stdout.write(
    `${JSON.stringify({ type: 'suite_result', ...result })}\n`,
  )
}

const failed = results.filter((result) => !result.ok)
process.stdout.write(
  `${JSON.stringify({
    type: 'hard_suite_summary',
    ok: failed.length === 0,
    smoke,
    passed: results.length - failed.length,
    failed: failed.map((result) => result.name),
    results,
  })}\n`,
)

if (failed.length > 0) process.exitCode = 1
