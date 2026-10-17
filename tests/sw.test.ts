import { describe, expect, it, vi } from 'vitest'
import source from '../public/sw.js?raw'

type Res = { ok: boolean; status: number; clone: () => Res }
const response = (status: number): Res => ({ ok: status < 400, status, clone: () => response(status) })

/** Runs the real sw.js against fake browser globals and returns a way to send it fetch events. */
function loadWorker(
  network: (url: string) => Promise<Res>,
  cached: Record<string, Res> = {},
  cacheNames: string[] = [],
) {
  const handlers: Record<string, (event: unknown) => void> = {}
  const put = vi.fn()
  const remove = vi.fn(async () => true)
  const claim = vi.fn(async () => {})
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim },
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
  }
  const caches = {
    open: async () => ({ put }),
    match: async (req: { url: string } | string) => cached[typeof req === 'string' ? req : req.url],
    keys: async () => cacheNames,
    delete: remove,
  }
  new Function('self', 'caches', 'fetch', source)(self, caches, (req: { url: string }) => network(req.url))

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
  return { request, activate, put, remove, claim }
}

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
})
