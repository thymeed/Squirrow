import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Entry, Id, Project, Snapshot } from './types'

export interface Repository {
  load(): Promise<Snapshot>
  putProject(p: Project): Promise<void>
  deleteProject(id: Id): Promise<void>
  putEntry(e: Entry): Promise<void>
  deleteEntry(id: Id): Promise<void>
  replaceAll(s: Snapshot): Promise<void>
}

interface Schema extends DBSchema {
  projects: { key: string; value: Project }
  entries: { key: string; value: Entry; indexes: { byProject: string } }
}

export function createIndexedDbRepository(name = 'context-keeper'): Repository {
  const dbp: Promise<IDBPDatabase<Schema>> = openDB<Schema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id' })
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('byProject', 'projectId')
    },
  })
  return {
    async load() {
      const db = await dbp
      return { version: 1, projects: await db.getAll('projects'), entries: await db.getAll('entries') }
    },
    async putProject(p) {
      await (await dbp).put('projects', p)
    },
    async deleteProject(id) {
      const db = await dbp
      const tx = db.transaction(['projects', 'entries'], 'readwrite')
      const entries = tx.objectStore('entries')
      for (const key of await entries.index('byProject').getAllKeys(id)) await entries.delete(key)
      await tx.objectStore('projects').delete(id)
      await tx.done
    },
    async putEntry(e) {
      await (await dbp).put('entries', e)
    },
    async deleteEntry(id) {
      await (await dbp).delete('entries', id)
    },
    async replaceAll(s) {
      const db = await dbp
      const tx = db.transaction(['projects', 'entries'], 'readwrite')
      await Promise.all([tx.objectStore('projects').clear(), tx.objectStore('entries').clear()])
      await Promise.all([
        ...s.projects.map((p) => tx.objectStore('projects').put(p)),
        ...s.entries.map((e) => tx.objectStore('entries').put(e)),
      ])
      await tx.done
    },
  }
}
