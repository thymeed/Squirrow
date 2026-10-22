import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const CACHE_LINE = /const CACHE = '[^']*'/

export function stampServiceWorker(source, version) {
  if (!CACHE_LINE.test(source)) throw new Error("sw.js has no `const CACHE = '...'` line to stamp")
  return source.replace(CACHE_LINE, `const CACHE = 'squirrow-${version}'`)
}

/** A short hash of every shipped file, so the stamp changes exactly when something users download changes. */
export function versionOf(files) {
  const hash = createHash('sha256')
  for (const { path, bytes } of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(path).update('\0').update(bytes).update('\0')
  }
  return hash.digest('hex').slice(0, 10)
}

function listFiles(dir, root = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(join(dir, e.name), root)
      : [{ path: relative(root, join(dir, e.name)).split(sep).join('/'), file: join(dir, e.name) }],
  )
}

export function stampSwPlugin() {
  let outDir = 'dist'
  return {
    name: 'stamp-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const files = listFiles(outDir).filter((f) => f.path !== 'sw.js')
      const version = versionOf(files.map((f) => ({ path: f.path, bytes: readFileSync(f.file) })))
      const swPath = join(outDir, 'sw.js')
      writeFileSync(swPath, stampServiceWorker(readFileSync(swPath, 'utf8'), version))
    },
  }
}
