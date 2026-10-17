import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { Repository } from '../src/core/repository'
import { useStore } from '../src/core/store'
import { newId, type Snapshot } from '../src/core/types'

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
  replaceAll: async () => {},
})

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

describe('store', () => {
  it('reports an error instead of loading forever when load fails', async () => {
    const store = await renderStore(fakeRepo(() => Promise.reject(new Error('blocked'))))
    expect(store.ready).toBe(false)
    expect(store.error).toBe("Couldn't load your data")
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
})
