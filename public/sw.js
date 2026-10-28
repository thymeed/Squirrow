const CACHE = 'squirrow-dev'

// The build writes `/assets/x.js` in the page and CSS, and `./x.js` for lazy chunks inside JS.
const ASSET_REF = /(?:\.\/|\/assets\/)[\w.-]+\.\w+/g

async function precache() {
  const cache = await caches.open(CACHE)
  await cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])
  // Walks from the page through every CSS and JS file under /assets, so lazy chunks are cached too.
  // An asset is queued only the first time it is found, which also stops any cycle between chunks.
  const assets = new Set()
  const pending = ['/']
  while (pending.length > 0) {
    const url = pending.pop()
    const text = await (await fetch(url)).text()
    for (const [ref] of text.matchAll(ASSET_REF)) {
      const asset = new URL(ref, new URL(url, self.location.origin)).pathname
      if (!asset.startsWith('/assets/') || assets.has(asset)) continue
      assets.add(asset)
      if (/\.(css|js)$/.test(asset)) pending.push(asset)
    }
  }
  await cache.addAll([...assets])
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
})

// An update waits until the page asks for it, so an open tab is never swapped mid-edit.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      if (!hit) return fresh
      fresh.catch(() => {}) // Offline: the cached copy is enough.
      return hit
    }),
  )
})
