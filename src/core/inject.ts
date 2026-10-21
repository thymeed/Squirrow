import { afterLabel, fenceBlock, oneLine } from './markdown'
import { scoreEntries } from './search'
import type { Entry, EntryKind, Id, Project } from './types'

/** Rough heuristic: about 4 characters per token for English text. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

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

export function buildContext(project: Project, entries: Entry[]): string {
  const lines = [`# Context: ${project.name}`, '']
  for (const kind of Object.keys(HEADINGS) as EntryKind[]) {
    const group = entries
      .filter((e) => e.kind === kind)
      .sort((a, b) => a.updatedAt - b.updatedAt || byId(a, b))
    if (group.length === 0) continue
    lines.push(`## ${HEADINGS[kind]}`)
    for (const e of group) {
      lines.push(
        kind === 'snippet'
          ? `### ${oneLine(e.title)}\n${fenceBlock(e.body)}`
          : `- **${oneLine(e.title)}**${e.body ? afterLabel(e.body) : ''}`,
      )
    }
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
 * measured context still fits the budget. An entry that does not fit is dropped, and the
 * fill keeps trying smaller ones after it.
 */
export function selectContext(
  project: Project,
  entries: Entry[],
  query: string,
  budget: number,
  pinned: ReadonlySet<Id>,
): Selection {
  const scores = scoreEntries(entries, query)
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
  const tokensOf = (list: Entry[]) => estimateTokens(buildContext(project, list))

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

  const included = [...forced]
  const dropped: Entry[] = []
  for (const e of ranked) {
    if (pinned.has(e.id)) continue
    if (tokensOf([...included, e]) <= budget) included.push(e)
    else dropped.push(e)
  }
  return { included, dropped, tokens: tokensOf(included), overBudget: false }
}
