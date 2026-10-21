import type { Entry, Id } from './types'

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'set',
  'up',
  'to',
  'of',
  'in',
  'on',
  'a',
  'an',
  'is',
  'are',
  'my',
  'our',
  'this',
  'that',
  'it',
  'be',
  'from',
  'into',
  'how',
  'what',
  'why',
  'do',
  'does',
])

/** A title hit weighs 3, a body hit 1. Zero means the term appears in neither. */
function termWeight(title: string[], body: string[], term: string): number {
  return (title.some((w) => w.startsWith(term)) ? 3 : 0) + (body.some((w) => w.startsWith(term)) ? 1 : 0)
}

/** Every query term must prefix-match a word in the entry. 0 means no match. */
function scoreEntry(e: Entry, terms: string[]): number {
  const title = tokenize(e.title)
  const body = tokenize(e.body)
  let score = 0
  for (const t of terms) {
    const weight = termWeight(title, body, t)
    if (weight === 0) return 0
    score += weight
  }
  return score
}

/** Scores each entry against a task sentence. Each distinct content word adds its weight, so partial matches count. */
export function scoreTask(entries: Entry[], task: string): Map<Id, number> {
  const terms = [...new Set(tokenize(task))].filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  return new Map(
    entries.map((e) => {
      const title = tokenize(e.title)
      const body = tokenize(e.body)
      return [e.id, terms.reduce((sum, t) => sum + termWeight(title, body, t), 0)]
    }),
  )
}

export function searchEntries(entries: Entry[], query: string): Entry[] {
  const terms = tokenize(query)
  if (terms.length === 0) return entries
  return entries
    .map((e) => ({ e, score: scoreEntry(e, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt)
    .map((s) => s.e)
}
