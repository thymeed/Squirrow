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

export interface ModelProfile {
  id: string
  label: string
  contextTokens: number
}

export const MODEL_PROFILES: readonly ModelProfile[] = [
  { id: 'claude', label: 'Claude', contextTokens: 200_000 },
  { id: 'gpt', label: 'GPT', contextTokens: 128_000 },
  { id: 'gemini', label: 'Gemini', contextTokens: 1_000_000 },
  { id: 'small', label: 'Small local model', contextTokens: 8_000 },
]

export const BUDGET_SHARES = [0.05, 0.1, 0.25] as const

export const budgetTokens = (contextTokens: number, share: number): number =>
  Math.floor(contextTokens * share)
