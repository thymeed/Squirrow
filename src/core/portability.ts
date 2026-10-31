import { afterLabel, oneLine } from './markdown'
import { ENTRY_KINDS, type Entry, type Project, type SavedPick, type Snapshot } from './types'

export const exportJson = (s: Snapshot): string =>
  JSON.stringify({ ...s, savedPicks: s.savedPicks ?? [] }, null, 2)

export function exportMarkdown(s: Snapshot): string {
  return s.projects
    .map((p) => {
      const rows = s.entries
        .filter((e) => e.projectId === p.id)
        .map((e) => `- [${e.kind}] **${oneLine(e.title)}**${afterLabel(e.body)}`)
      return `# ${oneLine(p.name)}\n\n${rows.join('\n')}\n`
    })
    .join('\n')
}

/** Rough guard against huge files: about 100 MB of text, enough for an export of about 50,000 entries. */
export const MAX_IMPORT_CHARS = 100_000_000

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Parses untrusted JSON into a Snapshot, throwing a readable error on any shape mismatch. */
export function parseSnapshot(text: string): Snapshot {
  if (text.length > MAX_IMPORT_CHARS)
    throw new Error(`File is too large to import (limit ${MAX_IMPORT_CHARS / 1_000_000} MB)`)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.projects) || !Array.isArray(raw.entries)) {
    throw new Error('Not a Squirrow export (expected version 1)')
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
  // Absent in files exported before saved picks existed, which then have none.
  const savedPicks = raw.savedPicks === undefined ? [] : parsePicks(raw.savedPicks, ids)
  return { version: 1, projects, entries, savedPicks }
}

function parsePicks(raw: unknown, projectIds: Set<string>): SavedPick[] {
  if (!Array.isArray(raw)) throw new Error('Invalid saved pick in file')
  const pickIds = new Set<string>()
  return raw.map((p): SavedPick => {
    if (
      !isObj(p) ||
      typeof p.id !== 'string' ||
      typeof p.projectId !== 'string' ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      !Array.isArray(p.entryIds) ||
      !p.entryIds.every((id) => typeof id === 'string') ||
      !projectIds.has(p.projectId)
    ) {
      throw new Error('Invalid saved pick in file')
    }
    if (pickIds.has(p.id)) throw new Error('Duplicate saved pick id in file')
    pickIds.add(p.id)
    return {
      id: p.id as SavedPick['id'],
      projectId: p.projectId as SavedPick['projectId'],
      name: p.name,
      entryIds: p.entryIds as SavedPick['entryIds'],
      createdAt: Number(p.createdAt) || 0,
    }
  })
}
