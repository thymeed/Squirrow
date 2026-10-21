import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { buildContext, estimateTokens } from '../src/core/inject'
import { MAX_IMPORT_CHARS, exportJson, exportMarkdown, parseSnapshot } from '../src/core/portability'
import { createIndexedDbRepository } from '../src/core/repository'
import { searchEntries } from '../src/core/search'
import {
  BUDGET_SHARES,
  MODEL_PROFILES,
  budgetTokens,
  newId,
  type Entry,
  type Project,
  type Snapshot,
} from '../src/core/types'

const project: Project = { id: newId(), name: 'Demo', createdAt: 1 }
const entry = (title: string, body = '', kind: Entry['kind'] = 'fact', updatedAt = 1): Entry => ({
  id: newId(),
  projectId: project.id,
  kind,
  title,
  body,
  updatedAt,
})
const snapshot = (entries: Entry[]): Snapshot => ({ version: 1, projects: [project], entries })

describe('search', () => {
  const a = entry('Database choice', 'We use Postgres')
  const b = entry('Style', 'prefers postgres naming and tabs')
  it('requires all terms and ranks title hits first', () => {
    expect(searchEntries([b, a], 'postgres')).toHaveLength(2)
    expect(searchEntries([b, a], 'data post')[0]).toBe(a)
    expect(searchEntries([a, b], 'postgres zzz')).toEqual([])
  })
  it('returns everything for an empty query', () => {
    expect(searchEntries([a, b], '  ')).toHaveLength(2)
  })
})

describe('model budget', () => {
  it.each(MODEL_PROFILES)('gives $id its own cap for every share', (profile) => {
    for (const share of BUDGET_SHARES) {
      expect(budgetTokens(profile.contextTokens, share)).toBe(Math.floor(profile.contextTokens * share))
    }
    const caps = MODEL_PROFILES.map((p) => budgetTokens(p.contextTokens, 0.1))
    expect(new Set(caps).size).toBe(MODEL_PROFILES.length)
  })
  it('gives the small model 800 tokens at a 10% share', () => {
    expect(budgetTokens(8000, 0.1)).toBe(800)
  })
})

describe('inject', () => {
  it('groups by kind and fences snippets', () => {
    const text = buildContext(project, [
      entry('Use tabs', 'always', 'preference'),
      entry('helper', 'x = 1', 'snippet'),
    ])
    expect(text).toContain('## Preferences\n- **Use tabs**: always')
    expect(text).toContain('### helper\n```\nx = 1\n```')
  })
  it('fences a snippet that contains ``` with a longer fence', () => {
    const text = buildContext(project, [entry('helper', 'a\n```\nb', 'snippet')])
    expect(text).toContain('### helper\n````\na\n```\nb\n````')
  })
  it('fences a non-snippet body that contains ```', () => {
    const text = buildContext(project, [entry('Run it', 'use:\n```\nnpm test\n```')])
    expect(text).toContain('- **Run it**:\n````\nuse:\n```\nnpm test\n```\n````')
  })
  it('keeps a multi-line title on one line', () => {
    const text = buildContext(project, [entry('one\n```\ntwo', 'x', 'snippet')])
    expect(text).toContain('### one ``` two\n```\nx\n```')
  })
  it('keeps every line of a multi-line body inside its list item', () => {
    const text = buildContext(project, [entry('Notes', 'line one\n## not a section'), entry('Next')])
    expect(text).toContain('- **Notes**: line one\n  ## not a section\n- **Next**')
    expect(exportMarkdown(snapshot([entry('Notes', 'a\n# b')]))).toContain('**Notes**: a\n  # b')
  })
  it('estimates tokens at 4 chars each, rounded up', () => {
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('portability', () => {
  it('round-trips through JSON', () => {
    const s = snapshot([entry('A', 'b')])
    expect(parseSnapshot(exportJson(s))).toEqual(s)
  })
  it('rejects bad input with a readable error', () => {
    expect(() => parseSnapshot('nope')).toThrow('valid JSON')
    expect(() => parseSnapshot('{"version":2}')).toThrow('Not a Squirrow')
    expect(() =>
      parseSnapshot(
        JSON.stringify({
          version: 1,
          projects: [],
          entries: [{ id: 'x', projectId: 'y', kind: 'fact', title: 't' }],
        }),
      ),
    ).toThrow('Invalid entry')
  })
  it('exports plain entries as Markdown rows', () => {
    expect(exportMarkdown(snapshot([entry('A', 'b')]))).toBe('# Demo\n\n- [fact] **A**: b\n')
  })
  it('exports a body containing ``` inside a longer fence', () => {
    expect(exportMarkdown(snapshot([entry('Run it', 'x\n```\ny')]))).toContain(
      '- [fact] **Run it**:\n````\nx\n```\ny\n````',
    )
  })
  it('accepts a snapshot whose ids are all unique', () => {
    const s = snapshot([entry('A'), entry('B'), entry('C')])
    expect(parseSnapshot(exportJson(s)).entries).toHaveLength(3)
  })
  it('rejects duplicate project ids', () => {
    const s = { ...snapshot([]), projects: [project, { ...project, name: 'Copy' }] }
    expect(() => parseSnapshot(exportJson(s))).toThrow('Duplicate project id')
  })
  it('rejects duplicate entry ids', () => {
    const a = entry('A')
    expect(() => parseSnapshot(exportJson(snapshot([a, { ...a, title: 'B' }])))).toThrow('Duplicate entry id')
  })
  it('rejects files over the size limit before parsing', () => {
    expect(() => parseSnapshot(' '.repeat(MAX_IMPORT_CHARS + 1))).toThrow('too large')
  })
})

describe('repository', () => {
  it('persists across repository instances and cascades project deletes', async () => {
    const name = `t-${newId()}`
    const first = createIndexedDbRepository(name)
    const e = entry('Persisted')
    await first.putProject(project)
    await first.putEntry(e)
    const reopened = await createIndexedDbRepository(name).load()
    expect(reopened.entries).toEqual([e])
    await first.deleteProject(project.id)
    expect(await first.load()).toMatchObject({ projects: [], entries: [] })
  })
  it('replaceAll swaps the full dataset', async () => {
    const repo = createIndexedDbRepository(`t-${newId()}`)
    await repo.putEntry(entry('old'))
    const s = snapshot([entry('new')])
    await repo.replaceAll(s)
    expect(await repo.load()).toMatchObject({ entries: s.entries })
  })
  it('copies legacy data into the new database without overwriting later changes', async () => {
    const legacy = `legacy-${newId()}`
    const e = entry('Kept')
    const old = createIndexedDbRepository(legacy, null)
    await old.putProject(project)
    await old.putEntry(e)
    const name = `t-${newId()}`
    const migrated = createIndexedDbRepository(name, legacy)
    expect(await migrated.load()).toMatchObject({ projects: [project], entries: [e] })
    await migrated.deleteProject(project.id)
    const reopened = createIndexedDbRepository(name, legacy)
    expect(await reopened.load()).toMatchObject({ projects: [], entries: [] })
  })
  it('starts empty instead of failing when the legacy database cannot be read', async () => {
    const legacy = `legacy-${newId()}`
    const broken = await openDB(legacy, 1, {
      upgrade: (db) => void db.createObjectStore('projects', { keyPath: 'id' }),
    })
    broken.close()
    const repo = createIndexedDbRepository(`t-${newId()}`, legacy)
    expect(await repo.load()).toMatchObject({ projects: [], entries: [] })
    expect((await indexedDB.databases()).map((d) => d.name)).toContain(legacy)
  })
  it('leaves an empty install alone when no legacy database exists', async () => {
    const legacy = `legacy-${newId()}`
    const repo = createIndexedDbRepository(`t-${newId()}`, legacy)
    expect(await repo.load()).toMatchObject({ projects: [], entries: [] })
    const names = (await indexedDB.databases()).map((d) => d.name)
    expect(names).not.toContain(legacy)
  })
})
