import { describe, expect, it } from 'vitest'
import source from '../public/sw.js?raw'
import { findUnprecached } from '../scripts/check-sw-scan.mjs'

/** A small build that the real worker should precache completely. */
const realistic = (): Record<string, string> => ({
  '/': '<script type="module" src="/assets/index-AAAA1111.js"></script><link rel="stylesheet" href="/assets/index-BBBB2222.css">',
  '/assets/index-AAAA1111.js': 'const load = () => import(`./o200k_base-CCCC3333.js`)',
  '/assets/o200k_base-CCCC3333.js': 'export const n = 1',
  '/assets/index-BBBB2222.css': 'body{--s:url(/assets/scenery-DDDD4444.svg)}',
  '/assets/scenery-DDDD4444.svg': '<svg></svg>',
})

/** The same build without its o200k chunk, for tests that put a different chunk in its place. */
const withoutO200k = () => {
  const files = realistic()
  delete files['/assets/o200k_base-CCCC3333.js']
  return files
}

const check = (files: Record<string, string>) => findUnprecached({ swSource: source, files })

describe('service worker scan check', () => {
  it('reports nothing for a layout the worker fully precaches', async () => {
    expect(await check(realistic())).toEqual([])
  })

  it('reports a lazy chunk whose hash is not 8 characters, since the scan will not follow it', async () => {
    const files = {
      ...withoutO200k(),
      '/assets/index-AAAA1111.js': 'const load = () => import(`./o200k_base-CCCC33334.js`)',
      '/assets/o200k_base-CCCC33334.js': 'export const n = 1',
    }
    expect(await check(files)).toEqual(['/assets/o200k_base-CCCC33334.js'])
  })

  it('reports a lazy chunk referenced without a hash, since the scan ignores plain relative names', async () => {
    const files = {
      ...withoutO200k(),
      '/assets/index-AAAA1111.js': 'const load = () => import("./lazy.js")',
      '/assets/lazy.js': 'export const l = 1',
    }
    expect(await check(files)).toEqual(['/assets/lazy.js'])
  })

  it('reports an asset under /assets/ that nothing references', async () => {
    const files = { ...realistic(), '/assets/orphan-EEEE5555.svg': '<svg></svg>' }
    expect(await check(files)).toEqual(['/assets/orphan-EEEE5555.svg'])
  })

  it('ignores files outside /assets/ for the missing check', async () => {
    const files = {
      ...realistic(),
      '/favicon.svg': '<svg></svg>',
      '/stray-CCCC3333.js': 'export const s = 1',
    }
    expect(await check(files)).toEqual([])
  })
})
