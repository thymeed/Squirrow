import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const TEXT_FILE = /\.(html|css|js|svg|webmanifest|txt|xml)$/

/** Runs the real worker's install handler against fake globals and returns every URL it precaches. */
async function precachedUrls(swSource, files) {
  const handlers = {}
  const cached = new Set()
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type, fn) => (handlers[type] = fn),
  }
  const caches = {
    open: async () => ({
      addAll: async (urls) => urls.forEach((url) => cached.add(url)),
    }),
  }
  const fetch = async (url) => {
    const body = files[new URL(url, 'https://app.test').pathname]
    if (body === undefined) return { ok: false, status: 404, text: async () => '' }
    const text = typeof body === 'string' ? body : new TextDecoder().decode(body)
    return { ok: true, status: 200, text: async () => text }
  }
  new Function('self', 'caches', 'fetch', swSource)(self, caches, fetch)
  let installing
  handlers.install({ waitUntil: (p) => (installing = p) })
  await installing
  return cached
}

/** The files under /assets/ that the worker's scan would not precache. `files` maps request paths to text or bytes. */
export async function findUnprecached({ swSource, files }) {
  const precached = await precachedUrls(swSource, files)
  return Object.keys(files)
    .filter((path) => path.startsWith('/assets/') && !precached.has(path))
    .sort()
}

function distFiles(dir, root = dir) {
  const files = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(files, distFiles(full, root))
    } else {
      const path = '/' + relative(root, full).split(sep).join('/')
      files[path] = TEXT_FILE.test(entry.name) ? readFileSync(full, 'utf8') : readFileSync(full)
    }
  }
  return files
}

// Runs only when executed directly, not when a test imports findUnprecached.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = distFiles('dist')
  files['/'] = files['/index.html']
  const swSource = readFileSync(join('dist', 'sw.js'), 'utf8')
  const missing = await findUnprecached({ swSource, files })
  if (missing.length > 0) {
    for (const path of missing) {
      console.error(
        `dist${path} is not precached: the service worker's scan (ASSET_REF in public/sw.js) did not find it`,
      )
    }
    process.exit(1)
  }
  const count = Object.keys(files).filter((path) => path.startsWith('/assets/')).length
  console.log(`service worker precaches all ${count} files under dist/assets`)
}
