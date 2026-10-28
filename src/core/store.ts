import { useCallback, useEffect, useMemo, useState } from 'react'
import { sameName } from './picks'
import { createIndexedDbRepository, type DbNotice, type Repository } from './repository'
import { newId, type Entry, type Id, type Project, type SavedPick, type Snapshot } from './types'

const EMPTY: Snapshot = { version: 1, projects: [], entries: [], savedPicks: [] }

const NOTICE_TEXT: Record<DbNotice, string> = {
  blocked: 'Squirrow is open in another tab with an older version. Close or reload that tab to continue.',
  superseded:
    'Squirrow was updated in another tab, so this one closed its database. Reload this page to continue.',
  lost: 'Squirrow lost its connection to the browser storage. Reload this page to continue.',
}

export function useStore(repo?: Repository) {
  const [data, setData] = useState<Snapshot>(EMPTY)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the repository this hook creates reports notices. A repository passed in does not.
  const repository = useMemo(
    () => repo ?? createIndexedDbRepository(undefined, undefined, (notice) => setError(NOTICE_TEXT[notice])),
    [repo],
  )

  useEffect(() => {
    repository.load().then(
      (s) => {
        setData(s)
        setError(null)
        setReady(true)
      },
      (err) => {
        console.error(err)
        setError("Couldn't load your data")
      },
    )
  }, [repository])

  const addProject = useCallback(
    async (name: string) => {
      const p: Project = { id: newId(), name, createdAt: Date.now() }
      await repository.putProject(p)
      setData((d) => ({ ...d, projects: [...d.projects, p] }))
      return p.id
    },
    [repository],
  )

  const removeProject = useCallback(
    async (id: Id) => {
      await repository.deleteProject(id)
      setData((d) => ({
        ...d,
        projects: d.projects.filter((p) => p.id !== id),
        entries: d.entries.filter((e) => e.projectId !== id),
        savedPicks: (d.savedPicks ?? []).filter((p) => p.projectId !== id),
      }))
    },
    [repository],
  )

  const saveEntry = useCallback(
    async (e: Omit<Entry, 'id' | 'updatedAt'> & { id?: Id }) => {
      const entry: Entry = { ...e, id: e.id ?? newId(), updatedAt: Date.now() }
      await repository.putEntry(entry)
      setData((d) => ({
        ...d,
        entries: d.entries.some((x) => x.id === entry.id)
          ? d.entries.map((x) => (x.id === entry.id ? entry : x))
          : [...d.entries, entry],
      }))
    },
    [repository],
  )

  const removeEntry = useCallback(
    async (id: Id) => {
      await repository.deleteEntry(id)
      setData((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }))
    },
    [repository],
  )

  // Picks are matched by name within the project. The name is trimmed and compared ignoring case
  // (see sameName). An existing pick keeps its id and spelling. Returns whether one was overwritten.
  const savePick = useCallback(
    async (projectId: Id, name: string, entryIds: Id[]) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Give the pick a name before saving')
      const ids = [...new Set(entryIds)]
      if (ids.length === 0) throw new Error('Tick some entries before saving a pick')
      const picks = data.savedPicks ?? []
      const existing = picks.find((p) => p.projectId === projectId && sameName(p.name, trimmed))
      const pick: SavedPick = {
        id: existing?.id ?? newId(),
        projectId,
        name: existing?.name ?? trimmed,
        entryIds: ids,
        createdAt: existing?.createdAt ?? Date.now(),
      }
      await repository.putSavedPick(pick)
      setData((d) => {
        const current = d.savedPicks ?? []
        return {
          ...d,
          savedPicks: current.some((p) => p.id === pick.id)
            ? current.map((p) => (p.id === pick.id ? pick : p))
            : [...current, pick],
        }
      })
      return { pick, replaced: existing !== undefined }
    },
    [repository, data.savedPicks],
  )

  const removePick = useCallback(
    async (id: Id) => {
      await repository.deleteSavedPick(id)
      setData((d) => ({ ...d, savedPicks: (d.savedPicks ?? []).filter((p) => p.id !== id) }))
    },
    [repository],
  )

  const replaceAll = useCallback(
    async (s: Snapshot) => {
      await repository.replaceAll(s)
      setData({ ...s, savedPicks: s.savedPicks ?? [] })
    },
    [repository],
  )

  return {
    data,
    ready,
    error,
    addProject,
    removeProject,
    saveEntry,
    removeEntry,
    savePick,
    removePick,
    replaceAll,
  }
}
