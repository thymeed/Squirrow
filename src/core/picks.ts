import type { Entry, Id, SavedPick } from './types'

/** Two pick names are the same when they match ignoring surrounding spaces and capitalization. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The entries of a saved pick that still exist in its project, in the pick's order, and how many
 * were missing (deleted since the pick was saved). Each id is counted once.
 */
export function resolvePick(pick: SavedPick, entries: Entry[]): { entryIds: Id[]; missing: number } {
  const wanted = [...new Set(pick.entryIds)]
  const live = new Set(entries.filter((e) => e.projectId === pick.projectId).map((e) => e.id))
  const entryIds = wanted.filter((id) => live.has(id))
  return { entryIds, missing: wanted.length - entryIds.length }
}
