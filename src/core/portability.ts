import { ENTRY_KINDS, type Entry, type Project, type Snapshot } from './types'

export const exportJson = (s: Snapshot): string => JSON.stringify(s, null, 2)

export function exportMarkdown(s: Snapshot): string {
  return s.projects
    .map((p) => {
      const rows = s.entries
        .filter((e) => e.projectId === p.id)
        .map((e) => `- [${e.kind}] **${e.title}**: ${e.body}`)
      return `# ${p.name}\n\n${rows.join('\n')}\n`
    })
    .join('\n')
}

/** Rough guard against huge files: about 10 MB of text, far beyond any real export. */
export const MAX_IMPORT_CHARS = 10_000_000

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Parses untrusted JSON into a Snapshot, throwing a readable error on any shape mismatch. */
export function parseSnapshot(text: string): Snapshot {
  if (text.length > MAX_IMPORT_CHARS) throw new Error('File is too large to import (limit 10 MB)')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.projects) || !Array.isArray(raw.entries)) {
    throw new Error('Not a Context Keeper export (expected version 1)')
  }
  const projects = raw.projects.map((p): Project => {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string')
      throw new Error('Invalid project in file')
    return { id: p.id as Project['id'], name: p.name, createdAt: Number(p.createdAt) || 0 }
  })
  const ids = new Set<string>(projects.map((p) => p.id))
  if (ids.size !== projects.length) throw new Error('Duplicate project id in file')
  const entryIds = new Set<string>()
  const entries = raw.entries.map((e): Entry => {
    if (
      !isObj(e) ||
      typeof e.id !== 'string' ||
      typeof e.projectId !== 'string' ||
      typeof e.title !== 'string' ||
      !ENTRY_KINDS.includes(e.kind as Entry['kind']) ||
      !ids.has(e.projectId)
    ) {
      throw new Error('Invalid entry in file')
    }
    if (entryIds.has(e.id)) throw new Error('Duplicate entry id in file')
    entryIds.add(e.id)
    return {
      id: e.id as Entry['id'],
      projectId: e.projectId as Entry['projectId'],
      kind: e.kind as Entry['kind'],
      title: e.title,
      body: typeof e.body === 'string' ? e.body : '',
      updatedAt: Number(e.updatedAt) || 0,
    }
  })
  return { version: 1, projects, entries }
}
