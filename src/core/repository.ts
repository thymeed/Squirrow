import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Entry, Id, Project, SavedPick, Snapshot } from './types'

export interface Repository {
  load(): Promise<Snapshot>
  putProject(p: Project): Promise<void>
  deleteProject(id: Id): Promise<void>
  putEntry(e: Entry): Promise<void>
  deleteEntry(id: Id): Promise<void>
  putSavedPick(p: SavedPick): Promise<void>
  deleteSavedPick(id: Id): Promise<void>
  replaceAll(s: Snapshot): Promise<void>
}

/**
 * Why this tab cannot use the database for now. `blocked`: an older tab still holds it, so the open waits.
 * `superseded`: a newer version needs it, so this tab closed its connection. `lost`: the browser closed it.
 */
export type DbNotice = 'blocked' | 'superseded' | 'lost'

interface Schema extends DBSchema {
  projects: { key: string; value: Project }
  entries: { key: string; value: Entry; indexes: { byProject: string } }
  savedPicks: { key: string; value: SavedPick; indexes: { byProject: string } }
}

const DB_NAME = 'squirrow'
const LEGACY_DB_NAME = 'context-keeper'

async function migrateLegacy(db: IDBPDatabase<Schema>, legacyName: string): Promise<void> {
  let legacy: IDBPDatabase<Schema>
  try {
    // No version: read the legacy database at whatever version it has. The abort stops a missing one from being created.
    legacy = await openDB<Schema>(legacyName, undefined, {
      upgrade(_db, _old, _new, tx) {
        tx.done.catch(() => {})
        tx.abort()
      },
    })
  } catch {
    return
  }
  try {
    const projects = await legacy.getAll('projects')
    const entries = await legacy.getAll('entries')
    legacy.close()
    const tx = db.transaction(['projects', 'entries'], 'readwrite')
    await Promise.all([
      ...projects.map((p) => tx.objectStore('projects').put(p)),
      ...entries.map((e) => tx.objectStore('entries').put(e)),
    ])
    await tx.done
  } catch {
    legacy.close()
    return
  }
  void deleteDB(legacyName).catch(() => {})
}

export function createIndexedDbRepository(
  name = DB_NAME,
  legacyName: string | null = name === DB_NAME ? LEGACY_DB_NAME : null,
  onNotice: (notice: DbNotice) => void = () => {},
): Repository {
  // Only a brand-new database (no version yet) copies the legacy data. An upgrade keeps what it has.
  let created = false
  const dbp: Promise<IDBPDatabase<Schema>> = openDB<Schema>(name, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        created = true
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('byProject', 'projectId')
      }
      if (oldVersion < 2) {
        db.createObjectStore('savedPicks', { keyPath: 'id' }).createIndex('byProject', 'projectId')
      }
    },
    // An older tab still holds the database, so the open waits until that tab closes its connection.
    blocked() {
      onNotice('blocked')
    },
    // A newer version needs the database. Let go of this connection so it can upgrade; the user reloads.
    blocking(_current, _blocked, event) {
      const connection = event.target as IDBDatabase
      connection.close()
      onNotice('superseded')
    },
    terminated() {
      onNotice('lost')
    },
  }).then(async (db) => {
    if (created && legacyName) await migrateLegacy(db, legacyName)
    return db
  })
  return {
    async load() {
      const db = await dbp
      return {
        version: 1,
        projects: await db.getAll('projects'),
        entries: await db.getAll('entries'),
        savedPicks: await db.getAll('savedPicks'),
      }
    },
    async putProject(p) {
      await (await dbp).put('projects', p)
    },
    async deleteProject(id) {
      const db = await dbp
      const tx = db.transaction(['projects', 'entries', 'savedPicks'], 'readwrite')
      const entries = tx.objectStore('entries')
      for (const key of await entries.index('byProject').getAllKeys(id)) await entries.delete(key)
      const picks = tx.objectStore('savedPicks')
      for (const key of await picks.index('byProject').getAllKeys(id)) await picks.delete(key)
      await tx.objectStore('projects').delete(id)
      await tx.done
    },
    async putEntry(e) {
      await (await dbp).put('entries', e)
    },
    async deleteEntry(id) {
      await (await dbp).delete('entries', id)
    },
    async putSavedPick(p) {
      await (await dbp).put('savedPicks', p)
    },
    async deleteSavedPick(id) {
      await (await dbp).delete('savedPicks', id)
    },
    async replaceAll(s) {
      const db = await dbp
      const tx = db.transaction(['projects', 'entries', 'savedPicks'], 'readwrite')
      // tx.done rejects when the transaction aborts, and that is handled below, so it is not left unhandled.
      tx.done.catch(() => {})
      const writes: Promise<unknown>[] = []
      try {
        // Every request is issued in this same tick, so the transaction is still open for an abort below.
        writes.push(
          tx.objectStore('projects').clear(),
          tx.objectStore('entries').clear(),
          tx.objectStore('savedPicks').clear(),
        )
        writes.push(...s.projects.map((p) => tx.objectStore('projects').put(p)))
        writes.push(...s.entries.map((e) => tx.objectStore('entries').put(e)))
        writes.push(...(s.savedPicks ?? []).map((p) => tx.objectStore('savedPicks').put(p)))
        await Promise.all(writes)
        await tx.done
      } catch (err) {
        // One failed write rolls back the clears too, so the old data survives. The browser may have
        // aborted the transaction already, in which case the extra abort is refused and ignored.
        void Promise.allSettled(writes)
        try {
          tx.abort()
        } catch {}
        throw err
      }
    },
  }
}
