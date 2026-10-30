// One benchmark process for one (operation, size) pair. Started by run.mjs, which kills it when a single run
// exceeds the time cap: synchronous code cannot be interrupted from inside the process.
// Loads the TypeScript through Vite's SSR loader (no new dependency), prepares the inputs, then prints one JSON
// line per message: ready, then one run line per timed run (the first is a warm-up), then done.
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const [, , op, sizeArg, runsArg] = process.argv
const size = Number(sizeArg)
const runs = Number(runsArg)
const root = fileURLToPath(new URL('..', import.meta.url))

const emit = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  // No dependency pre-bundling: the worker only loads src/ and bench/, and each run would otherwise leave a deps_temp folder.
  // The ssr block is needed too: the SSR loader runs its own optimizer, which leaves the folder on a cold cache.
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
})

async function main() {
  const { generateFixture, QUERY, TASK } = await server.ssrLoadModule('/bench/fixtures.ts')
  const search = await server.ssrLoadModule('/src/core/search.ts')
  const inject = await server.ssrLoadModule('/src/core/inject.ts')
  const portability = await server.ssrLoadModule('/src/core/portability.ts')

  const fx = generateFixture(size)
  const { project, entries, snapshot } = fx
  const none = new Set()

  // Setup (budgets, tokenizer load) happens here, before the timer starts.
  let run
  switch (op) {
    case 'searchEntries':
      run = () => search.searchEntries(entries, QUERY)
      break
    case 'scoreTask':
      run = () => search.scoreTask(entries, TASK)
      break
    case 'buildContext':
      run = () => inject.buildContext(project, entries)
      break
    case 'selectContextEstimate': {
      const budget = Math.floor(inject.estimateTokens(inject.buildContext(project, entries)) / 2)
      run = () => inject.selectContext(project, entries, TASK, budget, none, inject.estimateTokens)
      break
    }
    case 'selectContextTokenizer': {
      const count = await inject.loadTokenCounter()
      if (!count) throw new Error('tokenizer unavailable')
      const budget = Math.floor(count(inject.buildContext(project, entries)) / 2)
      run = () => inject.selectContext(project, entries, TASK, budget, none, count)
      break
    }
    case 'exportMarkdown':
      run = () => portability.exportMarkdown(snapshot)
      break
    case 'roundTrip':
      emit({ type: 'info', jsonChars: portability.exportJson(snapshot).length })
      run = () => portability.parseSnapshot(portability.exportJson(snapshot))
      break
    default:
      throw new Error(`unknown operation ${op}`)
  }

  emit({ type: 'ready' })
  for (let i = 0; i <= runs; i++) {
    const t0 = performance.now()
    run()
    const ms = performance.now() - t0
    emit({ type: 'run', ms, warmup: i === 0 })
  }
}

let code = 0
try {
  await main()
  emit({ type: 'done' })
} catch (err) {
  emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  code = 1
} finally {
  await server.close()
  // Let the pipe flush before exiting.
  process.stdout.write('', () => process.exit(code))
}
