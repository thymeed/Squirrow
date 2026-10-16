import { describe, expect, it } from 'vitest'
import { buildContext, estimateTokens } from '../src/core/inject'
import { exportJson, parseSnapshot } from '../src/core/portability'
import { createIndexedDbRepository } from '../src/core/repository'
import { searchEntries } from '../src/core/search'
import { newId, type Entry, type Project, type Snapshot } from '../src/core/types'

const project: Project = { id: newId(), name: 'Demo', createdAt: 1 }
const entry = (title: string, body = '', kind: Entry['kind'] = 'fact', updatedAt = 1): Entry => ({
  id: newId(), projectId: project.id, kind, title, body, updatedAt,
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

describe('inject', () => {
  it('groups by kind and fences snippets', () => {
    const text = buildContext(project, [entry('Use tabs', 'always', 'preference'), entry('helper', 'x = 1', 'snippet')])
    expect(text).toContain('## Preferences\n- **Use tabs**: always')
    expect(text).toContain('### helper\n```\nx = 1\n```')
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
    expect(() => parseSnapshot('{"version":2}')).toThrow('Not a Context Keeper')
    expect(() => parseSnapshot(JSON.stringify({ version: 1, projects: [], entries: [{ id: 'x', projectId: 'y', kind: 'fact', title: 't' }] }))).toThrow('Invalid entry')
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
})
