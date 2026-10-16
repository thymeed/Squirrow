export type Id = string & { readonly __brand: 'Id' }

export const ENTRY_KINDS = ['fact', 'decision', 'preference', 'snippet', 'file-note'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export interface Project {
  id: Id
  name: string
  createdAt: number
}

export interface Entry {
  id: Id
  projectId: Id
  kind: EntryKind
  title: string
  body: string
  updatedAt: number
}

export interface Snapshot {
  version: 1
  projects: Project[]
  entries: Entry[]
}

export const newId = (): Id => crypto.randomUUID() as Id
