import { useCallback, useEffect, useMemo, useState } from 'react'
import { createIndexedDbRepository, type Repository } from './repository'
import { newId, type Entry, type EntryKind, type Id, type Project, type Snapshot } from './types'

const EMPTY: Snapshot = { version: 1, projects: [], entries: [] }

export function useStore(repo?: Repository) {
  const repository = useMemo(() => repo ?? createIndexedDbRepository(), [repo])
  const [data, setData] = useState<Snapshot>(EMPTY)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    repository
      .load()
      .then((s) => {
        setData(s)
        setReady(true)
      })
      .catch((err) => {
        console.error(err)
        setError("Couldn't load your data")
      })
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

  const replaceAll = useCallback(
    async (s: Snapshot) => {
      await repository.replaceAll(s)
      setData(s)
    },
    [repository],
  )

  return { data, ready, error, addProject, removeProject, saveEntry, removeEntry, replaceAll }
}

export type { EntryKind }
