// Scaling benchmark for the pure core logic in src/core. Run with `npm run bench`.
// Each (operation, size) runs in its own worker process (worker.mjs) so that a run over the cap can be killed.
import { spawn } from 'node:child_process'
import { arch, cpus, platform, release, type } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZES = [100, 1000, 5000, 10000, 50000]
const CAP_MS = 60_000
const SETUP_LIMIT_MS = 600_000
const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs')

const OPERATIONS = [
  { op: 'searchEntries', label: 'searchEntries (3-word query)' },
  { op: 'scoreTask', label: 'scoreTask (task sentence)' },
  { op: 'buildContext', label: 'buildContext (all entries)' },
  { op: 'selectContextEstimate', label: 'selectContext, estimateTokens' },
  { op: 'selectContextTokenizer', label: 'selectContext, o200k tokenizer' },
  { op: 'exportMarkdown', label: 'exportMarkdown' },
  { op: 'roundTrip', label: 'exportJson + parseSnapshot' },
]

const runsFor = (size) => (size <= 1000 ? 5 : 3)

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const fmtMs = (ms) => ms.toFixed(ms < 10 ? 2 : 1)

/** Runs one (operation, size) in a child process and returns what it measured. */
function runWorker(op, size) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, op, String(size), String(runsFor(size))], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const measured = []
    const result = { runs: measured, info: undefined, error: undefined, capped: false, setupTimeout: false }
    let stdout = ''
    let stderr = ''
    let timer = setTimeout(() => {
      result.setupTimeout = true
      child.kill()
    }, SETUP_LIMIT_MS)
    // Each run gets CAP_MS: the timer restarts on every message from the child.
    const armCap = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        result.capped = true
        child.kill()
      }, CAP_MS)
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      let nl
      while ((nl = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, nl).trim()
        stdout = stdout.slice(nl + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          // Stray output (a warning, a stray console.log) is not a protocol message: skip it.
          continue
        }
        if (msg.type === 'ready' || msg.type === 'run') armCap()
        if (msg.type === 'run') measured.push(msg)
        if (msg.type === 'info') result.info = msg
        if (msg.type === 'error') result.error = msg.message
      }
    })
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !result.capped && !result.setupTimeout && !result.error) {
        result.error = stderr.trim().split('\n').pop() || `exit code ${code}`
      }
      resolve(result)
    })
  })
}

/** The table cell for one result, plus the note text when there is one. */
function cellFor(result) {
  if (result.capped) return { text: '>60 s (capped)' }
  if (result.setupTimeout) return { text: 'setup timeout' }
  const timed = result.runs.filter((r) => !r.warmup).map((r) => r.ms)
  if (result.error || timed.length === 0) return { text: 'error', note: result.error ?? 'no timed runs' }
  return { text: fmtMs(median(timed)) }
}

function printTable(header, rows) {
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)))
  const line = (cells) =>
    cells.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('  ')
  console.log(line(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(line(row))
}

async function main() {
  const cpu = cpus()
  console.log('Squirrow core scaling benchmark')
  console.log(`Date:   ${new Date().toISOString()}`)
  console.log(`Node:   ${process.version}`)
  console.log(`OS:     ${type()} ${release()} (${platform()} ${arch()})`)
  console.log(`CPU:    ${cpu[0]?.model ?? 'unknown'} (${cpu.length} logical cores)`)
  console.log('')

  const rows = OPERATIONS.map(({ label }) => [label])
  const notes = []
  const jsonChars = {}

  for (const [r, { op, label }] of OPERATIONS.entries()) {
    let capAt = null
    for (const size of SIZES) {
      if (capAt !== null && size > capAt) {
        rows[r].push('skipped')
        continue
      }
      process.stderr.write(`  ${label} @ ${size} ...\n`)
      const result = await runWorker(op, size)
      if (result.info) jsonChars[size] = result.info.jsonChars
      const cell = cellFor(result)
      if (cell.note) notes.push(`${label} @ ${size}: ${cell.note}`)
      if (result.capped) capAt = size
      rows[r].push(cell.text)
    }
  }

  printTable(['Operation (ms, median)', ...SIZES.map(String)], rows)
  console.log('')
  console.log('Runs: median of 5 timed runs for 100 and 1000, 3 for 5000 and up, after 1 warm-up run.')
  console.log('Timed: only the operation. Fixture generation and budget setup run before the timer.')
  console.log("Budget: half of the full context's tokens, so about 40-45% of the entries fit.")
  console.log(`Cap: a single run over ${CAP_MS / 1000} s is killed and reported; larger sizes are skipped.`)
  console.log(
    'Fixture: one project per size, all five kinds, titles 5-10 words, bodies 20-200 words, fixed seed.',
  )
  const sizes = Object.entries(jsonChars)
  if (sizes.length) {
    console.log(
      `Export JSON size (chars): ${sizes.map(([n, c]) => `${n} entries = ${c.toLocaleString('en-US')}`).join(', ')}`,
    )
  }
  if (notes.length) {
    console.log('Errors:')
    for (const note of notes) console.log(`  - ${note}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
