import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { Repository } from '../src/core/repository'
import { useStore } from '../src/core/store'
import { newId, type Id, type Project, type SavedPick, type Snapshot } from '../src/core/types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const fakeRepo = (load: () => Promise<Snapshot>): Repository => ({
  load,
  putProject: async () => {},
  deleteProject: async () => {},
  putEntry: async () => {},
  deleteEntry: async () => {},
  putSavedPick: async () => {},
  deleteSavedPick: async () => {},
  replaceAll: async () => {},
})

/** A repository that keeps picks in memory and records every write, so the store's calls can be checked. */
const pickRepo = (initial: Snapshot) => {
  const writes: string[] = []
  const repo: Repository = {
    ...fakeRepo(async () => initial),
    deleteProject: async (id) => void writes.push(`deleteProject ${id}`),
    putSavedPick: async (p) => void writes.push(`put ${p.id}`),
    deleteSavedPick: async (id) => void writes.push(`delete ${id}`),
  }
  return { repo, writes }
}

async function renderStore(repo: Repository) {
  let store!: ReturnType<typeof useStore>
  function Probe() {
    store = useStore(repo)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  return store
}

/** Like renderStore, but returns a getter so each call sees the latest state after a change. */
async function mountStore(repo: Repository) {
  let store!: ReturnType<typeof useStore>
  function Probe() {
    store = useStore(repo)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  return () => store
}

describe('store', () => {
  it('reports an error instead of loading forever when load fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = new Error('blocked')
    const store = await renderStore(fakeRepo(() => Promise.reject(cause)))
    expect(store.ready).toBe(false)
    expect(store.error).toBe("Couldn't load your data")
    expect(log).toHaveBeenCalledWith(cause)
    log.mockRestore()
  })
  it('becomes ready with the loaded data when load succeeds', async () => {
    const data: Snapshot = {
      version: 1,
      projects: [{ id: newId(), name: 'A', createdAt: 1 }],
      entries: [],
    }
    const store = await renderStore(fakeRepo(async () => data))
    expect(store.ready).toBe(true)
    expect(store.error).toBeNull()
    expect(store.data).toEqual(data)
  })

  describe('saved picks', () => {
    const project: Project = { id: newId(), name: 'A', createdAt: 1 }
    const other: Project = { id: newId(), name: 'B', createdAt: 2 }
    const pick = (projectId: Id, name: string, entryIds: Id[]): SavedPick => ({
      id: newId(),
      projectId,
      name,
      entryIds,
      createdAt: 1,
    })
    const base = (savedPicks: SavedPick[]): Snapshot => ({
      version: 1,
      projects: [project, other],
      entries: [],
      savedPicks,
    })

    it('saves a new pick under a trimmed name and says it was not a replacement', async () => {
      const { repo, writes } = pickRepo(base([]))
      const get = await mountStore(repo)
      const e1 = newId()
      const before = Date.now()
      let result!: Awaited<ReturnType<ReturnType<typeof useStore>['savePick']>>
      await act(async () => {
        result = await get().savePick(project.id, '  Core  ', [e1, e1])
      })
      expect(result.replaced).toBe(false)
      expect(result.pick).toMatchObject({ projectId: project.id, name: 'Core', entryIds: [e1] })
      expect(result.pick.createdAt).toBeGreaterThanOrEqual(before)
      expect(result.pick.createdAt).toBeLessThanOrEqual(Date.now())
      expect(get().data.savedPicks).toEqual([result.pick])
      expect(writes).toEqual([`put ${result.pick.id}`])
    })

    it('overwrites a pick with the same name in the same project, keeping its id', async () => {
      const old = pick(project.id, 'Core', [newId()])
      const { repo, writes } = pickRepo(base([old]))
      const get = await mountStore(repo)
      const fresh = newId()
      let result!: Awaited<ReturnType<ReturnType<typeof useStore>['savePick']>>
      await act(async () => {
        result = await get().savePick(project.id, 'Core', [fresh])
      })
      expect(result.replaced).toBe(true)
      expect(result.pick.id).toBe(old.id)
      expect(result.pick.createdAt).toBe(old.createdAt)
      expect(get().data.savedPicks).toEqual([result.pick])
      expect(get().data.savedPicks![0]!.entryIds).toEqual([fresh])
      expect(writes).toEqual([`put ${old.id}`])
    })

    it('overwrites a pick whose name differs only in capitalization, keeping its id and spelling', async () => {
      const old = pick(project.id, 'core', [newId()])
      const { repo, writes } = pickRepo(base([old]))
      const get = await mountStore(repo)
      const fresh = newId()
      let result!: Awaited<ReturnType<ReturnType<typeof useStore>['savePick']>>
      await act(async () => {
        result = await get().savePick(project.id, '  Core  ', [fresh])
      })
      expect(result.replaced).toBe(true)
      expect(result.pick).toMatchObject({ id: old.id, name: 'core', entryIds: [fresh] })
      expect(get().data.savedPicks).toEqual([result.pick])
      expect(writes).toEqual([`put ${old.id}`])
    })

    it('treats the same name in another project as a new pick', async () => {
      const { repo } = pickRepo(base([pick(other.id, 'Core', [newId()])]))
      const get = await mountStore(repo)
      let result!: Awaited<ReturnType<ReturnType<typeof useStore>['savePick']>>
      await act(async () => {
        result = await get().savePick(project.id, 'Core', [newId()])
      })
      expect(result.replaced).toBe(false)
      expect(get().data.savedPicks).toHaveLength(2)
    })

    it('rejects an empty name and saving nothing, without writing', async () => {
      const { repo, writes } = pickRepo(base([]))
      const get = await mountStore(repo)
      await expect(get().savePick(project.id, '   ', [newId()])).rejects.toThrow('Give the pick a name')
      await expect(get().savePick(project.id, 'Core', [])).rejects.toThrow('Tick some entries')
      expect(writes).toEqual([])
      expect(get().data.savedPicks).toEqual([])
    })

    it('removes a pick from state and the repository', async () => {
      const keep = pick(project.id, 'Keep', [newId()])
      const drop = pick(project.id, 'Drop', [newId()])
      const { repo, writes } = pickRepo(base([keep, drop]))
      const get = await mountStore(repo)
      await act(async () => get().removePick(drop.id))
      expect(get().data.savedPicks).toEqual([keep])
      expect(writes).toEqual([`delete ${drop.id}`])
    })

    it('drops the picks of a removed project from state and keeps the others', async () => {
      const mine = pick(project.id, 'Mine', [newId()])
      const theirs = pick(other.id, 'Theirs', [newId()])
      const { repo } = pickRepo(base([mine, theirs]))
      const get = await mountStore(repo)
      await act(async () => get().removeProject(project.id))
      expect(get().data.savedPicks).toEqual([theirs])
    })

    it('replaces the picks with the ones in an imported snapshot', async () => {
      const { repo } = pickRepo(base([pick(project.id, 'Old', [newId()])]))
      const get = await mountStore(repo)
      const incoming = pick(other.id, 'New', [])
      await act(async () => get().replaceAll(base([incoming])))
      expect(get().data.savedPicks).toEqual([incoming])
    })
  })
})
