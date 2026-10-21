import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
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

const DB_NAME = 'squirrow'
const LEGACY_DB_NAME = 'context-keeper'

async function migrateLegacy(db: IDBPDatabase<Schema>, legacyName: string): Promise<void> {
  let legacy: IDBPDatabase<Schema>
  try {
    legacy = await openDB<Schema>(legacyName, 1, {
      upgrade(_db, _old, _new, tx) {
        tx.done.catch(() => {})
        tx.abort()
      },
    })
  } catch {
    return
  }
  const projects = await legacy.getAll('projects')
  const entries = await legacy.getAll('entries')
  legacy.close()
  const tx = db.transaction(['projects', 'entries'], 'readwrite')
  await Promise.all([
    ...projects.map((p) => tx.objectStore('projects').put(p)),
    ...entries.map((e) => tx.objectStore('entries').put(e)),
  ])
  await tx.done
  void deleteDB(legacyName).catch(() => {})
}

export function createIndexedDbRepository(
  name = DB_NAME,
  legacyName: string | null = name === DB_NAME ? LEGACY_DB_NAME : null,
): Repository {
  let created = false
  const dbp: Promise<IDBPDatabase<Schema>> = openDB<Schema>(name, 1, {
    upgrade(db) {
      created = true
      db.createObjectStore('projects', { keyPath: 'id' })
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('byProject', 'projectId')
    },
  }).then(async (db) => {
    if (created && legacyName) await migrateLegacy(db, legacyName)
    return db
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
