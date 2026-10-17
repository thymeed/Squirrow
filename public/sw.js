const CACHE = 'context-keeper-v2'

async function precache() {
  const cache = await caches.open(CACHE)
  await cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])
  const assets = new Set()
  const scan = async (url) => {
    const text = await (await fetch(url)).text()
    for (const m of text.matchAll(/\/assets\/[\w.-]+\.\w+/g)) assets.add(m[0])
  }
  await scan('/')
  for (const url of [...assets].filter((u) => u.endsWith('.css'))) await scan(url)
  await cache.addAll([...assets])
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  self.skipWaiting()
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
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
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
      return hit ?? fresh
    }),
  )
})
