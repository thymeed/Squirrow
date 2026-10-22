import { describe, expect, it } from 'vitest'
import swSource from '../public/sw.js?raw'
import { stampServiceWorker, versionOf } from '../scripts/stamp-sw.mjs'

const file = (path: string, text: string) => ({ path, bytes: new TextEncoder().encode(text) })

describe('service worker version stamp', () => {
  it('replaces only the cache name in the real sw.js', () => {
    const stamped = stampServiceWorker(swSource, 'abc123')
    expect(stamped).toContain("const CACHE = 'squirrow-abc123'")
    expect(stamped.replace('squirrow-abc123', 'squirrow-dev')).toBe(swSource)
  })

  it('refuses a worker that has no cache line, so a build cannot ship an unstamped worker silently', () => {
    expect(() => stampServiceWorker('self.skipWaiting()', 'abc')).toThrow(/CACHE/)
  })

  it('gives the same version for the same files in any order', () => {
    const a = file('index.html', 'one')
    const b = file('assets/app.js', 'two')
    expect(versionOf([a, b])).toBe(versionOf([b, a]))
  })

  it('changes the version when any file content or name changes', () => {
    const base = versionOf([file('index.html', 'one'), file('assets/app.js', 'two')])
    expect(versionOf([file('index.html', 'one!'), file('assets/app.js', 'two')])).not.toBe(base)
    expect(versionOf([file('index.html', 'one'), file('assets/other.js', 'two')])).not.toBe(base)
  })
})
