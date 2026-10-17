import { afterLabel, fenceBlock, oneLine } from './markdown'
import type { Entry, EntryKind, Project } from './types'

/** Rough heuristic: about 4 characters per token for English text. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

const HEADINGS: Record<EntryKind, string> = {
  fact: 'Facts',
  decision: 'Decisions',
  preference: 'Preferences',
  snippet: 'Snippets',
  'file-note': 'File notes',
}

export function buildContext(project: Project, entries: Entry[]): string {
  const lines = [`# Context: ${project.name}`, '']
  for (const kind of Object.keys(HEADINGS) as EntryKind[]) {
    const group = entries.filter((e) => e.kind === kind)
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
