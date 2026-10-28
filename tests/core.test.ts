import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import {
  LAST_EXPORT_KEY,
  NUDGE_DISMISSED_KEY,
  dismissedUntilFrom,
  readStoredTime,
  shouldShowBackupNudge,
  writeStoredTime,
} from '../src/core/backup'
import { buildContext, estimateTokens, selectContext } from '../src/core/inject'
import { MAX_IMPORT_CHARS, exportJson, exportMarkdown, parseSnapshot } from '../src/core/portability'
import { createIndexedDbRepository } from '../src/core/repository'
import { filterByKinds, scoreTask, searchEntries } from '../src/core/search'
import {
  BUDGET_SHARES,
  MODEL_PROFILES,
  budgetTokens,
  parseContextWindow,
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

describe('kind filter', () => {
  const fact = entry('Fact', '', 'fact')
  const decision = entry('Decision', '', 'decision')
  const snippet = entry('Snippet', '', 'snippet')
  const all = [fact, decision, snippet]
  const titles = (list: Entry[]) => list.map((e) => e.title)
  it('keeps everything for an empty set of kinds', () => {
    expect(filterByKinds(all, new Set())).toEqual(all)
  })
  it('keeps only the entries of one kind', () => {
    expect(titles(filterByKinds(all, new Set(['decision'])))).toEqual(['Decision'])
  })
  it('keeps the entries of every chosen kind, in their original order', () => {
    expect(titles(filterByKinds(all, new Set(['snippet', 'fact'])))).toEqual(['Fact', 'Snippet'])
  })
})

describe('task scoring', () => {
  const a = entry('Database choice', 'We use Postgres')
  const b = entry('Style', 'prefers postgres naming and tabs')
  it('scores a title hit 3 and a body hit 1, and a partial match above zero', () => {
    expect(scoreTask([a, b], 'data').get(a.id)).toBe(3)
    expect(scoreTask([a, b], 'postgres').get(a.id)).toBe(1)
    expect(scoreTask([a, b], 'postgres zzz').get(a.id)).toBe(1)
  })
  it('never counts stopwords or words of one or two letters', () => {
    expect(scoreTask([a], 'the database')).toEqual(scoreTask([a], 'database'))
    expect(scoreTask([a], 'us')).toEqual(new Map([[a.id, 0]]))
    expect([...scoreTask([a, b], 'the and for with set up to of in on a an is are').values()]).toEqual([0, 0])
  })
  it('gives every entry a zero score for an empty or all-stopword task', () => {
    expect([...scoreTask([a, b], '  ').values()]).toEqual([0, 0])
    expect([...scoreTask([a, b], 'how do i').values()]).toEqual([0, 0])
  })
})

describe('task scoring on long, chatty tasks', () => {
  it('does not let common request words outrank a rare relevant term', () => {
    const relevant = entry('Parser', 'the csv parser lives here')
    const chatty = entry('Team notes', 'can you help me write and make and use new things, please')
    const scores = scoreTask(
      [relevant, chatty],
      'can you help me write and make and use new things to parse csv',
    )
    expect(scores.get(relevant.id)!).toBeGreaterThan(scores.get(chatty.id)!)
  })
  it('only reads the first words of a very long task', () => {
    const rare = entry('Zebra', 'ends the list')
    const task = `${Array.from({ length: 200 }, (_, i) => `filler${i}`).join(' ')} zebra`
    expect(scoreTask([rare], task).get(rare.id)).toBe(0)
  })
})

describe('context window input', () => {
  it('accepts whole numbers from 1000 to 10 million and nothing else', () => {
    expect(
      ['999', '1000', ' 5000 ', '10000000', '10000001', '1e6', '12.5', '', 'abc', '-5'].map(
        parseContextWindow,
      ),
    ).toEqual([null, 1000, 5000, 10_000_000, null, null, null, null, null, null])
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
  it('ships the default window for each model family', () => {
    expect(Object.fromEntries(MODEL_PROFILES.map((p) => [p.id, p.contextTokens]))).toEqual({
      claude: 200000,
      gpt: 128000,
      gemini: 1000000,
      small: 8000,
    })
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
    const text = buildContext(project, [
      entry('Notes', 'line one\n## not a section'),
      entry('Next', '', 'fact', 2),
    ])
    expect(text).toContain('- **Notes**: line one\n  ## not a section\n- **Next**')
    expect(exportMarkdown(snapshot([entry('Notes', 'a\n# b')]))).toContain('**Notes**: a\n  # b')
  })
  it('estimates tokens at 4 chars each, rounded up', () => {
    expect(estimateTokens('abcde')).toBe(2)
  })
  it('lists each kind oldest first, so the same entries give the same text in any order', () => {
    const older = entry('Older', 'a', 'fact', 1)
    const newer = entry('Newer', 'b', 'fact', 9)
    const tie = [entry('Same one', '', 'fact', 5), entry('Same two', '', 'fact', 5)]
    const all = [newer, older, ...tie]
    expect(buildContext(project, all)).toBe(buildContext(project, [...all].reverse()))
    const text = buildContext(project, all)
    expect(text.indexOf('**Older**')).toBeLessThan(text.indexOf('**Newer**'))
  })
})

describe('selectContext', () => {
  const hit = entry('Postgres setup', 'v16', 'fact', 10)
  const bodyHit = entry('Storage', 'postgres here', 'fact', 5)
  const pref = entry('Tabs', '', 'preference', 1)
  const newest = entry('Colors', '', 'fact', 50)
  const all = [newest, pref, bodyHit, hit]
  const pick = (entries: Entry[], query: string, budget: number, pinned: Entry[] = []) =>
    selectContext(project, entries, query, budget, new Set(pinned.map((e) => e.id)))
  const titles = (list: Entry[]) => list.map((e) => e.title)

  it('keeps the highest-ranked entries when the budget forces drops', () => {
    const budget = estimateTokens(buildContext(project, [hit, bodyHit]))
    const result = pick(all, 'postgres', budget)
    expect(titles(result.included)).toEqual(['Postgres setup', 'Storage'])
    expect(titles(result.dropped)).toEqual(['Tabs', 'Colors'])
    expect(result.overBudget).toBe(false)
    expect(result.tokens).toBe(budget)
  })
  it('keeps the title match when only one entry fits', () => {
    const budget = estimateTokens(buildContext(project, [hit]))
    expect(titles(pick(all, 'postgres', budget).included)).toEqual(['Postgres setup'])
  })
  it('ranks a preference above a newer fact when nothing matches', () => {
    const budget = estimateTokens(buildContext(project, [pref]))
    expect(titles(pick(all, '', budget).included)).toEqual(['Tabs'])
  })
  it('never exceeds the budget unless overBudget is set, and measures the real text', () => {
    for (const budget of [40, 80, 200, 400, 2000]) {
      const result = pick(all, 'postgres', budget)
      expect(result.overBudget || result.tokens <= budget).toBe(true)
      expect(result.tokens).toBe(estimateTokens(buildContext(project, result.included)))
    }
  })
  it('always includes pinned entries, even when they rank last', () => {
    const budget = estimateTokens(buildContext(project, [newest]))
    const result = pick(all, 'postgres', budget, [newest])
    expect(titles(result.included)).toEqual(['Colors'])
    expect(result.overBudget).toBe(false)
  })
  it('sets overBudget and drops everything else when pinned entries alone do not fit', () => {
    const result = pick(all, 'postgres', 10, [hit])
    expect(titles(result.included)).toEqual(['Postgres setup'])
    expect(titles(result.dropped)).toEqual(['Storage', 'Tabs', 'Colors'])
    expect(result.overBudget).toBe(true)
    expect(result.tokens).toBeGreaterThan(10)
  })
  it('ranks kinds decision, preference, fact, file-note, snippet when scores and times tie', () => {
    const snippet = entry('Snippet', 'const a = 1', 'snippet', 1)
    const fileNote = entry('File note', 'a note', 'file-note', 1)
    const fact = entry('Fact', 'a fact', 'fact', 1)
    const preference = entry('Preference', 'a pref', 'preference', 1)
    const decision = entry('Decision', 'a choice', 'decision', 1)
    const tied = [snippet, fileNote, fact, preference, decision]
    expect(titles(pick(tied, '', 100000).included)).toEqual([
      'Decision',
      'Preference',
      'Fact',
      'File note',
      'Snippet',
    ])
    const topTwo = estimateTokens(buildContext(project, [decision, preference]))
    expect(titles(pick(tied, '', topTwo).included)).toEqual(['Decision', 'Preference'])
  })
  it('keeps a pinned entry over a better match when only one fits', () => {
    const budget = Math.max(
      estimateTokens(buildContext(project, [hit])),
      estimateTokens(buildContext(project, [newest])),
    )
    const result = pick(all, 'postgres', budget, [newest])
    expect(titles(result.included)).toEqual(['Colors'])
    expect(result.overBudget).toBe(false)
  })
  it('ranks by the task words when the task is a whole sentence', () => {
    const budget = estimateTokens(buildContext(project, [hit]))
    expect(titles(pick([pref, hit], 'set up postgres for the recipe app', budget).included)).toEqual([
      'Postgres setup',
    ])
  })
  it('ranks an entry that matches part of the task above one that matches none', () => {
    const budget = estimateTokens(buildContext(project, [hit]))
    expect(titles(pick([pref, hit], 'postgres redis cache setup', budget).included)).toEqual([
      'Postgres setup',
    ])
  })
  it('gives the same selection for the same entries in any input order', () => {
    const forward = pick(all, 'postgres', 60)
    const backward = pick([...all].reverse(), 'postgres', 60)
    expect(titles(backward.included)).toEqual(titles(forward.included))
    expect(titles(backward.dropped)).toEqual(titles(forward.dropped))
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

describe('backup nudge', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 9, 27)
  // Entries seen 15 days ago, never exported, not snoozed: the reminder should show.
  const base = {
    now,
    entryCount: 3,
    lastExportAt: null,
    firstEntrySeenAt: now - 15 * DAY,
    dismissedUntil: null,
  }
  const fakeStorage = () => {
    const items = new Map<string, string>()
    return {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    }
  }

  it('shows when there is data, it was never exported, and entries were first seen 15 days ago', () => {
    expect(shouldShowBackupNudge(base)).toBe(true)
  })
  it('hides when there are no entries, even if never exported', () => {
    expect(shouldShowBackupNudge({ ...base, entryCount: 0 })).toBe(false)
  })
  it('hides a new user whose entries were first seen one day ago', () => {
    expect(shouldShowBackupNudge({ ...base, firstEntrySeenAt: now - DAY })).toBe(false)
  })
  it('hides at exactly 14 days after entries were first seen', () => {
    expect(shouldShowBackupNudge({ ...base, firstEntrySeenAt: now - 14 * DAY })).toBe(false)
  })
  it('shows once entries were first seen more than 14 days ago', () => {
    expect(shouldShowBackupNudge({ ...base, firstEntrySeenAt: now - 14 * DAY - 1 })).toBe(true)
  })
  it('hides when entries exist, but no first-seen time is recorded', () => {
    expect(shouldShowBackupNudge({ ...base, firstEntrySeenAt: null })).toBe(false)
  })
  it('hides when a recent export beats an old first-seen time', () => {
    expect(shouldShowBackupNudge({ ...base, lastExportAt: now - DAY })).toBe(false)
  })
  it('shows when an old export exists, regardless of a recent first-seen time', () => {
    expect(
      shouldShowBackupNudge({ ...base, lastExportAt: now - 15 * DAY, firstEntrySeenAt: now - DAY }),
    ).toBe(true)
  })
  it('hides when the last export was 13 days ago', () => {
    expect(shouldShowBackupNudge({ ...base, lastExportAt: now - 13 * DAY })).toBe(false)
  })
  it('hides at exactly 14 days after the last export', () => {
    expect(shouldShowBackupNudge({ ...base, lastExportAt: now - 14 * DAY })).toBe(false)
  })
  it('shows once the last export is just over 14 days old', () => {
    expect(shouldShowBackupNudge({ ...base, lastExportAt: now - 14 * DAY - 1 })).toBe(true)
  })
  it('hides while a dismissal is still running', () => {
    expect(shouldShowBackupNudge({ ...base, dismissedUntil: now + DAY })).toBe(false)
  })
  it('shows again once a dismissal has expired', () => {
    expect(shouldShowBackupNudge({ ...base, dismissedUntil: now - 1 })).toBe(true)
  })
  it('snoozes a dismissal for seven days', () => {
    expect(dismissedUntilFrom(now)).toBe(now + 7 * DAY)
  })

  it('round-trips a stored time and keeps the keys apart', () => {
    const store = fakeStorage()
    writeStoredTime(LAST_EXPORT_KEY, now, store)
    expect(readStoredTime(LAST_EXPORT_KEY, store)).toBe(now)
    expect(readStoredTime(NUDGE_DISMISSED_KEY, store)).toBeNull()
  })
  it('reads garbage stored values as null', () => {
    const store = fakeStorage()
    for (const raw of ['', 'abc', 'NaN', 'Infinity', '-5', '0', '{}']) {
      store.setItem(LAST_EXPORT_KEY, raw)
      expect(readStoredTime(LAST_EXPORT_KEY, store)).toBeNull()
    }
  })
  it('does not throw when localStorage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readStoredTime(LAST_EXPORT_KEY, blocked)).toBeNull()
    expect(() => writeStoredTime(LAST_EXPORT_KEY, now, blocked)).not.toThrow()
  })
})
