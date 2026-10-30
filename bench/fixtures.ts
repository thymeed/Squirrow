// Seeded synthetic projects for the scaling benchmark. Uses the real types from src/core/types.ts.
// The same size always yields the same data, so runs are comparable.
import { ENTRY_KINDS, type Entry, type Id, type Project, type Snapshot } from '../src/core/types'

/** Task sentence for scoreTask and selectContext. */
export const TASK = 'Fix the payment webhook retry logic so duplicate charges stop'

/** Two to three word query for searchEntries. */
export const QUERY = 'payment webhook retry'

const BASE_TIME = 1_700_000_000_000

const VOCAB = `billing webhook retry backoff payment invoice customer session token cache queue worker
schema migration index query latency timeout deploy staging production release branch review test fixture
component router hook store reducer render state effect memo bundle chunk asset image icon manifest service
offline sync export import backup restore snapshot project entry fact decision preference snippet note
config environment secret key certificate domain proxy gateway auth login password hash role permission
audit log metric alert dashboard table column row field form validation error warning retention quota limit
budget context prompt model embedding vector search ranking score weight pipeline stage job cron schedule
timezone locale currency format parser template markdown fence function module package dependency version
rollback feature flag experiment onboarding copy landing page meta tag redirect cookie storage transaction
cursor record value lookup merge conflict resolve default fallback circuit breaker throttle batch stream
buffer socket event emitter listener callback promise async closure scope generic interface union enum
nullable optional required reconcile duplicate charge refund ledger webhook signature idempotency`.split(
  /\s+/,
)

const FILLER = ['the', 'and', 'for', 'with', 'to', 'of', 'in', 'on', 'a', 'is', 'we', 'use', 'our', 'it']

const CODE = [
  'const',
  'let',
  'await',
  'return',
  'if',
  'else',
  'for',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  '=>',
  ';',
  '=',
  '.',
  ',',
  ':',
  '?',
  '===',
  'async',
  'function',
  'import',
  'export',
  'throw',
  'new',
  'try',
  'catch',
]

/** mulberry32: a small seeded PRNG, so the data is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Fixture {
  project: Project
  entries: Entry[]
  snapshot: Snapshot
}

/** A single project with `count` entries of all five kinds, mixed uniformly. */
export function generateFixture(count: number, seed = 20261030): Fixture {
  const rand = mulberry32(seed + count)
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const pool = [...VOCAB, ...FILLER]

  const title = () => {
    const words = Array.from({ length: int(5, 10) }, () => pick(pool))
    words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1)
    return words.join(' ')
  }

  const prose = (words: number) => {
    let text = ''
    for (let i = 0; i < words; i++) {
      text += pick(pool)
      if (i < words - 1) text += i % 12 === 11 ? '. ' : rand() < 0.03 ? '\n' : ' '
    }
    return text
  }

  // Snippets read like code: short lines of keywords, punctuation and identifiers.
  const code = (tokens: number) => {
    let text = ''
    let left = tokens
    while (left > 0) {
      const line = Math.min(left, int(3, 9))
      const parts = Array.from({ length: line }, () =>
        rand() < 0.5 ? pick(CODE) : pick(VOCAB) + pick(['', 'Id', 'Count', 'List']),
      )
      text += '  '.repeat(int(0, 2)) + parts.join(' ') + '\n'
      left -= line
    }
    return text.trimEnd()
  }

  const entries: Entry[] = Array.from({ length: count }, (_, i) => {
    const kind = pick(ENTRY_KINDS)
    const words = int(20, 200)
    return {
      id: `e${String(i).padStart(6, '0')}` as Id,
      projectId: 'p-bench' as Id,
      kind,
      title: title(),
      body: kind === 'snippet' ? code(words) : prose(words),
      updatedAt: BASE_TIME + Math.floor(rand() * 3e10),
    }
  })

  const project: Project = { id: 'p-bench' as Id, name: 'Bench project', createdAt: BASE_TIME }
  return { project, entries, snapshot: { version: 1, projects: [project], entries, savedPicks: [] } }
}
