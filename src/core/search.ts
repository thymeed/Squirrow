import type { Entry } from './types'

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Every query term must prefix-match a word in the entry. Title hits weigh 3x body hits. */
export function searchEntries(entries: Entry[], query: string): Entry[] {
  const terms = tokenize(query)
  if (terms.length === 0) return entries
  const scored: { e: Entry; score: number }[] = []
  for (const e of entries) {
    const title = tokenize(e.title)
    const body = tokenize(e.body)
    let score = 0
    let all = true
    for (const t of terms) {
      const inTitle = title.some((w) => w.startsWith(t))
      const inBody = body.some((w) => w.startsWith(t))
      if (!inTitle && !inBody) {
        all = false
        break
      }
      score += (inTitle ? 3 : 0) + (inBody ? 1 : 0)
    }
    if (all) scored.push({ e, score })
  }
  return scored.sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt).map((s) => s.e)
}
