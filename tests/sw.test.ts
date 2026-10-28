import { describe, expect, it, vi } from 'vitest'
import source from '../public/sw.js?raw'

type Res = { ok: boolean; status: number; clone: () => Res; text?: () => Promise<string> }
const response = (status: number): Res => ({ ok: status < 400, status, clone: () => response(status) })

/** Runs the real sw.js against fake browser globals and returns a way to send it fetch events. */
function loadWorker(
  network: (url: string) => Promise<Res>,
  cached: Record<string, Res> = {},
  cacheNames: string[] = [],
) {
  const handlers: Record<string, (event: unknown) => void> = {}
  const put = vi.fn()
  const addAll = vi.fn(async (_urls: string[]) => {})
  const remove = vi.fn(async (_name: string) => true)
  const claim = vi.fn(async () => {})
  const skipWaiting = vi.fn()
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim },
    skipWaiting,
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
  }
  const caches = {
    open: async () => ({ put, addAll }),
    match: async (req: { url: string } | string) => cached[typeof req === 'string' ? req : req.url],
    keys: async () => cacheNames,
    delete: remove,
  }
  // fetch takes a path string during precache and a Request object during fetch events.
  const fetchAny = (input: string | { url: string }) =>
    network(typeof input === 'string' ? new URL(input, 'https://app.test').href : input.url)
  new Function('self', 'caches', 'fetch', source)(self, caches, fetchAny)

  async function request(path: string, mode = 'no-cors') {
    let reply: Promise<Res> | undefined
    handlers.fetch!({
      request: { method: 'GET', url: `https://app.test${path}`, mode },
      respondWith: (p: Promise<Res>) => (reply = p),
    })
    const res = await reply!
    await new Promise((r) => setTimeout(r, 0))
    return res
  }
  async function activate() {
    let done: Promise<unknown> | undefined
    handlers.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  async function install() {
    let done: Promise<unknown> | undefined
    handlers.install!({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  const message = (data: unknown) => handlers.message!({ data })
  return { request, activate, install, message, put, addAll, remove, claim, skipWaiting }
}

/** Serves a small fake build from the given paths. Anything else is a 404. */
const build = (files: Record<string, string>) => async (url: string) => {
  const path = new URL(url).pathname
  if (!(path in files)) return response(404)
  return { ...response(200), text: async () => files[path]! }
}

const precached = (sw: ReturnType<typeof loadWorker>) => sw.addAll.mock.calls.flatMap(([urls]) => urls).sort()

describe('service worker', () => {
  it('caches a successful page load as the offline app shell', async () => {
    const sw = loadWorker(async () => response(200))
    await sw.request('/', 'navigate')
    expect(sw.put).toHaveBeenCalledWith('/', expect.objectContaining({ status: 200 }))
  })

  it('does not replace the offline app shell with an error page', async () => {
    const sw = loadWorker(async () => response(404))
    expect((await sw.request('/nope', 'navigate')).status).toBe(404)
    expect(sw.put).not.toHaveBeenCalled()
  })

  it('serves a cached asset offline without an unhandled network error', async () => {
    const hit = response(200)
    const sw = loadWorker(() => Promise.reject(new TypeError('offline')), {
      'https://app.test/assets/a.js': hit,
    })
    expect(await sw.request('/assets/a.js')).toBe(hit)
  })

  it('waits after installing until the page asks it to take over', async () => {
    const sw = loadWorker(async () => ({ ...response(200), text: async () => '' }) as Res)
    await sw.install()
    expect(sw.skipWaiting).not.toHaveBeenCalled()
    sw.message({ type: 'SOMETHING_ELSE' })
    expect(sw.skipWaiting).not.toHaveBeenCalled()
    sw.message({ type: 'SKIP_WAITING' })
    expect(sw.skipWaiting).toHaveBeenCalledOnce()
  })

  it('deletes old caches and takes over open tabs when it activates', async () => {
    const current = source.match(/const CACHE = '([^']+)'/)![1]!
    const sw = loadWorker(async () => response(200), {}, ['context-keeper-v1', 'context-keeper-v2', current])
    await sw.activate()
    expect(sw.remove.mock.calls.map(([name]) => name).sort()).toEqual([
      'context-keeper-v1',
      'context-keeper-v2',
    ])
    expect(sw.claim).toHaveBeenCalled()
  })

  it('precaches a lazy chunk that only the entry JS names', async () => {
    const sw = loadWorker(
      build({
        '/': '<script type="module" src="/assets/index-AAAA1111.js"></script><link rel="stylesheet" href="/assets/index-BBBB2222.css">',
        '/assets/index-AAAA1111.js': 'const load = () => import(`./o200k_base-CCCC3333.js`)',
        '/assets/o200k_base-CCCC3333.js': 'export const n = 1',
        '/assets/index-BBBB2222.css': 'body{--s:url(/assets/scenery-DDDD4444.svg)}',
      }),
    )
    await sw.install()
    expect(precached(sw)).toEqual(
      [
        '/',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/assets/index-AAAA1111.js',
        '/assets/index-BBBB2222.css',
        '/assets/o200k_base-CCCC3333.js',
        '/assets/scenery-DDDD4444.svg',
      ].sort(),
    )
  })

  it('follows chunks inside chunks, fetches each file once, and stops at cycles', async () => {
    const network = vi.fn(
      build({
        '/': '<script type="module" src="/assets/index-AAAA1111.js"></script>',
        '/assets/index-AAAA1111.js': 'import("./lazy-CCCC3333.js")',
        '/assets/lazy-CCCC3333.js':
          'import("./deeper-EEEE5555.js"); import("./lazy-CCCC3333.js"); import("/assets/index-AAAA1111.js")',
        '/assets/deeper-EEEE5555.js': 'export const deep = true',
      }),
    )
    const sw = loadWorker(network)
    await sw.install()
    expect(precached(sw)).toContain('/assets/deeper-EEEE5555.js')
    const fetched = network.mock.calls.map(([url]) => new URL(url).pathname).sort()
    expect(fetched).toEqual([
      '/',
      '/assets/deeper-EEEE5555.js',
      '/assets/index-AAAA1111.js',
      '/assets/lazy-CCCC3333.js',
    ])
  })

  it('ignores plain relative file names in JS, so a 404 there cannot break install', async () => {
    const network = vi.fn(
      build({
        '/': '<script type="module" src="/assets/index-AAAA1111.js"></script>',
        '/assets/index-AAAA1111.js':
          'const a = "./foo.js", b = "./notes.txt"; import(`./o200k_base-CCCC3333.js`)',
        '/assets/o200k_base-CCCC3333.js': 'export const n = 1',
      }),
    )
    const sw = loadWorker(network)
    await expect(sw.install()).resolves.toBeUndefined()
    const fetched = network.mock.calls.map(([url]) => new URL(url).pathname)
    expect(fetched).not.toContain('/assets/foo.js')
    expect(fetched).not.toContain('/assets/notes.txt')
    expect(precached(sw)).toEqual(
      [
        '/',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/assets/index-AAAA1111.js',
        '/assets/o200k_base-CCCC3333.js',
      ].sort(),
    )
  })

  it('ignores hashed chunk references in the page that would resolve outside /assets/', async () => {
    const network = vi.fn(
      build({
        '/': '<script type="module" src="/assets/index-AAAA1111.js"></script><script>import("./stray-CCCC3333.js")</script>',
        '/assets/index-AAAA1111.js': 'export const a = 1',
        '/stray-CCCC3333.js': 'export const s = 1',
      }),
    )
    const sw = loadWorker(network)
    await sw.install()
    const fetched = network.mock.calls.map(([url]) => new URL(url).pathname).sort()
    expect(fetched).toEqual(['/', '/assets/index-AAAA1111.js'])
    expect(precached(sw)).not.toContain('/stray-CCCC3333.js')
  })
})
