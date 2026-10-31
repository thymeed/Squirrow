import { afterLabel, fenceBlock, oneLine } from './markdown'
import { scoreTask } from './search'
import type { Entry, EntryKind, Id, Project } from './types'

/** Rough heuristic: about 4 characters per token for English text. Used when the real counter is not loaded. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export type TokenCounter = (text: string) => number

interface TokenizerModule {
  countTokens: (text: string, options?: { disallowedSpecial: Set<string> }) => number
}

/**
 * Builds a loader that imports the tokenizer once and then returns the same promise.
 * A failed import resolves to null and is not remembered, so a later call tries again.
 */
export function makeTokenCounterLoader(
  importer: () => Promise<TokenizerModule>,
): () => Promise<TokenCounter | null> {
  let pending: Promise<TokenCounter | null> | undefined
  return () => {
    pending ??= importer().then(
      (tokenizer): TokenCounter =>
        (text) => {
          try {
            // Special-token text such as "<|endoftext|>" is plain text in a chat, so count it as such.
            return tokenizer.countTokens(text, { disallowedSpecial: new Set() })
          } catch {
            return estimateTokens(text)
          }
        },
      () => {
        pending = undefined
        return null
      },
    )
    return pending
  }
}

/** The o200k tokenizer: exact for recent GPT models, approximate for Claude and Gemini. */
export const loadTokenCounter = makeTokenCounterLoader(() => import('gpt-tokenizer/encoding/o200k_base'))

const HEADINGS: Record<EntryKind, string> = {
  fact: 'Facts',
  decision: 'Decisions',
  preference: 'Preferences',
  snippet: 'Snippets',
  'file-note': 'File notes',
}

const KIND_PRIORITY: Record<EntryKind, number> = {
  decision: 0,
  preference: 1,
  fact: 2,
  'file-note': 3,
  snippet: 4,
}

const byId = (a: Entry, b: Entry) => Number(a.id > b.id) - Number(a.id < b.id)

/** The '## Heading' line that opens a kind's section. */
const headingLine = (kind: EntryKind): string => `## ${HEADINGS[kind]}`

/** One entry's line (or fenced block, for snippets) as it appears in the context. */
const entryLine = (e: Entry): string =>
  e.kind === 'snippet'
    ? `### ${oneLine(e.title)}\n${fenceBlock(e.body)}`
    : `- **${oneLine(e.title)}**${e.body ? afterLabel(e.body) : ''}`

export function buildContext(project: Project, entries: Entry[]): string {
  const lines = [`# Context: ${project.name}`, '']
  for (const kind of Object.keys(HEADINGS) as EntryKind[]) {
    const group = entries
      .filter((e) => e.kind === kind)
      .sort((a, b) => a.updatedAt - b.updatedAt || byId(a, b))
    if (group.length === 0) continue
    lines.push(headingLine(kind))
    for (const e of group) lines.push(entryLine(e))
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export interface Selection {
  included: Entry[]
  dropped: Entry[]
  tokens: number
  overBudget: boolean
}

/**
 * Pinned entries always go in. Other entries follow the ranking and are added while the
 * context still fits the budget. An entry that does not fit is dropped, and the fill keeps
 * trying smaller ones after it. `count` measures tokens; it defaults to the estimate.
 *
 * The fill does not rebuild the context for each candidate. It counts each piece once and adds the
 * piece counts to a running total. A piece is counted with the separator that follows it in the
 * final text: an entry's line plus '\n', and for a new kind its '## Heading' line plus '\n' plus
 * the blank line that closes the section. A tokenizer can still count a joined text differently
 * from its pieces, so at the end the final text is counted once. If that is over budget, the
 * last-added entries are removed one at a time, each time recounting, until it fits. `tokens` is
 * always the exact count of the returned text. `overBudget` is only set when the pinned entries
 * alone do not fit. Because pieces are counted separately, an entry that would fit exactly can occasionally be left out.
 */
export function selectContext(
  project: Project,
  entries: Entry[],
  query: string,
  budget: number,
  pinned: ReadonlySet<Id>,
  count: TokenCounter = estimateTokens,
): Selection {
  const scores = scoreTask(entries, query)
  const score = (e: Entry) => scores.get(e.id) ?? 0
  const ranked = [...entries].sort(
    (a, b) =>
      Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
      Number(score(b) > 0) - Number(score(a) > 0) ||
      score(b) - score(a) ||
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      b.updatedAt - a.updatedAt ||
      byId(a, b),
  )
  const tokensOf = (list: Entry[]) => count(buildContext(project, list))

  const forced = ranked.filter((e) => pinned.has(e.id))
  const forcedTokens = tokensOf(forced)
  if (forcedTokens > budget) {
    return {
      included: forced,
      dropped: ranked.filter((e) => !pinned.has(e.id)),
      tokens: forcedTokens,
      overBudget: true,
    }
  }

  const kindsSeen = new Set(forced.map((e) => e.kind))
  const added: Entry[] = []
  let running = forcedTokens
  for (const e of ranked) {
    if (pinned.has(e.id)) continue
    // Each piece is counted with the '\n' that follows it in buildContext's output.
    const cost = kindsSeen.has(e.kind)
      ? count(entryLine(e) + '\n')
      : count(entryLine(e) + '\n') + count(headingLine(e.kind) + '\n') + count('\n')
    if (running + cost <= budget) {
      running += cost
      kindsSeen.add(e.kind)
      added.push(e)
    }
  }

  let included = [...forced, ...added]
  let tokens = tokensOf(included)
  while (tokens > budget && added.length > 0) {
    added.pop()
    included = [...forced, ...added]
    tokens = tokensOf(included)
  }
  const chosen = new Set(included.map((e) => e.id))
  const dropped = ranked.filter((e) => !chosen.has(e.id))
  return { included, dropped, tokens, overBudget: false }
}
