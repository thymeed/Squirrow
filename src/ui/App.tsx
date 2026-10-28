import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import {
  LAST_EXPORT_KEY,
  FIRST_ENTRY_SEEN_KEY,
  NUDGE_DISMISSED_KEY,
  dismissedUntilFrom,
  readStoredTime,
  shouldShowBackupNudge,
  writeStoredTime,
} from '../core/backup'
import { MAX_DRAFTS, MAX_INPUT_CHARS, parseChatSummaryDetailed, type Draft } from '../core/chatImport'
import {
  buildContext,
  estimateTokens,
  loadTokenCounter,
  selectContext,
  type Selection,
  type TokenCounter,
} from '../core/inject'
import { exportJson, exportMarkdown, parseSnapshot } from '../core/portability'
import { resolvePick, sameName } from '../core/picks'
import { filterByKinds, searchEntries } from '../core/search'
import { useStore } from '../core/store'
import {
  BUDGET_SHARES,
  CUSTOM_MODEL_ID,
  ENTRY_KINDS,
  MODEL_PROFILES,
  budgetTokens,
  parseContextWindow,
  type Entry,
  type EntryKind,
  type Id,
  type SavedPick,
} from '../core/types'
import { useUpdateReady } from './useUpdateReady'

interface AutoPick {
  selection: Selection
  unticked: Entry[]
  total: number
  budget: number
  exact: boolean
}

/** Says which counter made a number: the real tokenizer, or the 4-character estimate. */
function CountNote({ exact }: { exact: boolean }) {
  return exact ? (
    <span className="hint" title="Exact for recent GPT models. Approximate for Claude and Gemini.">
      GPT-style count; close for Claude and Gemini
    </span>
  ) : (
    <span className="hint">estimate</span>
  )
}

const KIND_ICON: Record<EntryKind, string> = {
  fact: '💡',
  decision: '⚖️',
  preference: '❤️',
  snippet: '🧩',
  'file-note': '📄',
}

const KIND_HELP: Record<EntryKind, string> = {
  fact: 'Something true about your project, like "We use Postgres 16".',
  decision: 'A choice you made and why, like "Chose Vite because it starts fast".',
  preference: 'How you like things done, like "Use short, plain answers".',
  snippet: 'A piece of code you reuse. It is copied inside a code block.',
  'file-note': 'A note about one file, like "api.ts holds all network calls".',
}

function Welcome({ hasProject }: { hasProject: boolean }) {
  return (
    <div className="welcome">
      <div className="mascot" aria-hidden="true">
        🐿️
      </div>
      <h2>{hasProject ? 'Nothing saved here yet' : 'Welcome to Squirrow'}</h2>
      <p>Save what your AI should remember, then paste it into any chat with one click.</p>
      <ol>
        <li className={hasProject ? 'done' : ''}>Create a project, one per thing you are building.</li>
        <li>
          Add entries: facts, decisions and notes. Press <kbd>n</kbd> for a new one.
        </li>
        <li>Tick the ones you want and press Copy. Paste into your AI chat.</li>
      </ol>
    </div>
  )
}

const entriesText = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`

function download(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  // Some browsers start the download after click() returns, so revoke later.
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export function App() {
  const store = useStore()
  const { data } = store
  const [projectId, setProjectId] = useState<Id | null>(null)
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<EntryKind>>(new Set())
  const [selected, setSelected] = useState<Set<Id>>(new Set())
  // true: the user ticked it by hand. false: the user unticked it. Absent: Auto-pick decides.
  const [hand, setHand] = useState<Map<Id, boolean>>(new Map())
  const [modelId, setModelId] = useState(MODEL_PROFILES[0]?.id ?? '')
  const [customWindow, setCustomWindow] = useState('32000')
  const [share, setShare] = useState(0.1)
  const [task, setTask] = useState('')
  const [autoPick, setAutoPick] = useState<AutoPick | null>(null)
  const [editing, setEditing] = useState<Partial<Entry> | null>(null)
  const [importing, setImporting] = useState(false)
  // True while the import dialog saves its drafts. Esc and the overlay do not close the dialog then.
  const [importSaving, setImportSaving] = useState(false)
  const [pickName, setPickName] = useState('')
  const [notice, setNotice] = useState('')
  // Null until the tokenizer loads, and stays null if it fails. Then the 4-character estimate is used.
  const [counter, setCounter] = useState<TokenCounter | null>(null)
  const [lastExportAt, setLastExportAt] = useState(() => readStoredTime(LAST_EXPORT_KEY))
  const [dismissedUntil, setDismissedUntil] = useState(() => readStoredTime(NUDGE_DISMISSED_KEY))
  const [firstEntrySeenAt, setFirstEntrySeenAt] = useState(() => readStoredTime(FIRST_ENTRY_SEEN_KEY))
  const applyUpdate = useUpdateReady()
  const searchRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const project = data.projects.find((p) => p.id === projectId) ?? data.projects[0] ?? null
  const projectEntries = useMemo(
    () => data.entries.filter((e) => e.projectId === project?.id),
    [data.entries, project?.id],
  )
  const visible = useMemo(
    () => searchEntries(filterByKinds(projectEntries, kinds), query),
    [projectEntries, kinds, query],
  )
  const chosen = projectEntries.filter((e) => selected.has(e.id))
  const picks = useMemo(
    () => (store.data.savedPicks ?? []).filter((p) => p.projectId === project?.id),
    [store.data.savedPicks, project?.id],
  )
  const context = project ? buildContext(project, chosen) : ''
  const count: TokenCounter = counter ?? estimateTokens
  const tokenCount = useMemo(() => count(context), [count, context])

  useEffect(() => {
    let alive = true
    loadTokenCounter().then((loaded) => {
      if (alive && loaded) setCounter(() => loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setSelected(new Set())
    setHand(new Map())
    setKinds(new Set())
  }, [project?.id])

  useEffect(() => {
    setAutoPick(null)
  }, [project?.id, projectEntries])

  // Records the first time entries are seen in this browser. Only written once, so it never moves.
  useEffect(() => {
    if (!store.ready || data.entries.length === 0 || firstEntrySeenAt !== null) return
    const now = Date.now()
    writeStoredTime(FIRST_ENTRY_SEEN_KEY, now)
    setFirstEntrySeenAt(now)
  }, [store.ready, data.entries.length, firstEntrySeenAt])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const typing =
        ev.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)
      if (ev.key === 'Escape') {
        setEditing(null)
        if (!importSaving) setImporting(false)
      }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey || importing) return
      if (ev.key === '/') {
        ev.preventDefault()
        searchRef.current?.focus()
      }
      if (ev.key === 'n' && project) {
        ev.preventDefault()
        setEditing({ kind: 'fact', title: '', body: '' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project, importing, importSaving])

  const toggle = (id: Id) => {
    const nowTicked = !selected.has(id)
    setAutoPick(null)
    setHand((h) => new Map(h).set(id, nowTicked))
    setSelected((s) => {
      const next = new Set(s)
      if (nowTicked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleKind = (kind: EntryKind) => {
    setKinds((k) => {
      const next = new Set(k)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const addProject = async () => {
    const name = prompt('Project name')?.trim()
    if (name) setProjectId(await store.addProject(name))
  }

  const contextTokens =
    modelId === CUSTOM_MODEL_ID
      ? parseContextWindow(customWindow)
      : (MODEL_PROFILES.find((p) => p.id === modelId)?.contextTokens ?? null)
  const budget = contextTokens === null ? null : budgetTokens(contextTokens, share)

  const runAutoPick = () => {
    if (!project || budget === null) return
    const pinned = new Set<Id>([...hand].filter(([, ticked]) => ticked).map(([id]) => id))
    const unticked = projectEntries.filter((e) => hand.get(e.id) === false)
    const candidates = projectEntries.filter((e) => hand.get(e.id) !== false)
    const selection = selectContext(project, candidates, task, budget, pinned, count)
    setSelected(new Set(selection.included.map((e) => e.id)))
    setAutoPick({ selection, unticked, total: projectEntries.length, budget, exact: counter !== null })
  }

  // Saves the ticked entries. Ticked entries that were deleted are not in `chosen`, so they are not saved.
  const savePick = async () => {
    if (!project) return
    try {
      const { pick, replaced } = await store.savePick(
        project.id,
        pickName,
        chosen.map((e) => e.id),
      )
      setPickName('')
      setNotice(`${replaced ? 'Updated' : 'Saved'} "${pick.name}" with ${entriesText(pick.entryIds.length)}.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't save the pick")
    }
  }

  // Saves the kept drafts one after another, so each write lands before the next starts. Saving only
  // appends. On a failure it stops and reports how many were saved, and the dialog keeps the rest.
  const saveDrafts = async (kept: Draft[]): Promise<{ saved: number; error?: string }> => {
    if (!project) return { saved: 0, error: 'No project is open' }
    setImportSaving(true)
    try {
      let saved = 0
      for (const draft of kept) {
        try {
          await store.saveEntry({ ...draft, projectId: project.id })
        } catch (err) {
          const error = err instanceof Error ? err.message : "Couldn't save that entry"
          setNotice(`Saved ${saved} of ${kept.length} entries. The rest were not saved.`)
          return { saved, error }
        }
        saved++
      }
      setImporting(false)
      setNotice(`Imported ${entriesText(saved)}.`)
      return { saved }
    } finally {
      setImportSaving(false)
    }
  }

  // Loading is a manual choice: the loaded entries are hand-ticked (so Auto-pick keeps them), and
  // the rest have no hand record, so Auto-pick can still choose them. Deleted entries are skipped.
  const loadPick = (pick: SavedPick) => {
    const { entryIds, missing } = resolvePick(pick, projectEntries)
    if (entryIds.length === 0) {
      setNotice(
        missing
          ? `All ${entriesText(missing)} in "${pick.name}" ${missing === 1 ? 'was' : 'were'} deleted, so nothing was ticked.`
          : `"${pick.name}" has no entries, so nothing was ticked.`,
      )
      return
    }
    setAutoPick(null)
    setSelected(new Set(entryIds))
    setHand(new Map(entryIds.map((id) => [id, true])))
    const gone = missing ? ` ${missing} ${missing === 1 ? 'was' : 'were'} missing (deleted).` : ''
    setNotice(`Loaded ${entriesText(entryIds.length)}.${gone}`)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(context)
      setNotice(`Copied ~${tokenCount} tokens`)
    } catch {
      setNotice("Couldn't copy. Your browser blocked the clipboard, so select the text below and copy it.")
    }
  }

  // Shared by the sidebar button and the backup reminder, so both record the export.
  const exportBackup = () => {
    download('squirrow.json', exportJson(data), 'application/json')
    const now = Date.now()
    writeStoredTime(LAST_EXPORT_KEY, now)
    setLastExportAt(now)
  }

  const dismissNudge = () => {
    const until = dismissedUntilFrom(Date.now())
    writeStoredTime(NUDGE_DISMISSED_KEY, until)
    setDismissedUntil(until)
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const snapshot = parseSnapshot(await file.text())
      if (!confirm('Importing replaces all current projects and entries. Continue?')) return
      await store.replaceAll(snapshot)
      setNotice('Imported. Previous data was replaced.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Import failed')
    }
  }

  if (store.error)
    return (
      <p role="alert" className="loading error">
        {store.error}
      </p>
    )
  if (!store.ready) return <p className="loading">Loading...</p>

  const showNudge = shouldShowBackupNudge({
    now: Date.now(),
    entryCount: data.entries.length,
    lastExportAt,
    firstEntrySeenAt,
    dismissedUntil,
  })

  return (
    <div className="app">
      <aside>
        <h1>
          <span aria-hidden="true">🐿️</span> Squirrow
        </h1>
        <p className="tag">Local-first memory for your AI chats. Nothing leaves this browser.</p>
        <ul className="projects">
          {data.projects.map((p) => (
            <li key={p.id}>
              <button
                className={p.id === project?.id ? 'on' : ''}
                onClick={() => {
                  setProjectId(p.id)
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
        <button className="primary" onClick={addProject}>
          + New project
        </button>
        {project && (
          <button
            className="danger"
            onClick={() =>
              confirm(`Delete "${project.name}" and its entries?`) && store.removeProject(project.id)
            }
          >
            🗑 Delete project
          </button>
        )}
        <div className="io">
          <button onClick={exportBackup}>⬇ Export JSON</button>
          <button onClick={() => download('squirrow.md', exportMarkdown(data), 'text/markdown')}>
            ⬇ Export Markdown
          </button>
          <button onClick={() => importRef.current?.click()}>⬆ Import JSON</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              onImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <p className="hint">
          <kbd>/</kbd> search · <kbd>n</kbd> new entry · <kbd>Esc</kbd> close
        </p>
      </aside>

      <main>
        {showNudge && (
          <div className="nudge" role="status">
            <p>You haven't backed up lately. Export a copy of your data.</p>
            <div className="row">
              <button className="primary" onClick={exportBackup}>
                ⬇ Export
              </button>
              <button onClick={dismissNudge}>Dismiss</button>
            </div>
          </div>
        )}
        {!project ? (
          <Welcome hasProject={false} />
        ) : (
          <>
            <div className="bar">
              <input
                ref={searchRef}
                placeholder="Search entries ( / )"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="primary" onClick={() => setEditing({ kind: 'fact', title: '', body: '' })}>
                + Entry (n)
              </button>
              <button onClick={() => setImporting(true)}>Import from chat</button>
            </div>
            <div className="kind-filter" role="group" aria-label="Filter by kind">
              {ENTRY_KINDS.map((k) => (
                <button
                  key={k}
                  className={`kind-${k}`}
                  aria-pressed={kinds.has(k)}
                  onClick={() => toggleKind(k)}
                >
                  {KIND_ICON[k]} {k}
                </button>
              ))}
            </div>
            <ul className="entries">
              {visible.map((e) => (
                <li key={e.id} className={`kind-${e.kind}`}>
                  <label>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    <span className="kind">
                      {KIND_ICON[e.kind]} {e.kind}
                    </span>
                    <strong>{e.title}</strong>
                  </label>
                  <p>{e.body}</p>
                  <div className="row">
                    <button onClick={() => setEditing(e)}>✏️ Edit</button>
                    <button className="danger" onClick={() => store.removeEntry(e.id)}>
                      🗑 Delete
                    </button>
                  </div>
                </li>
              ))}
              {visible.length === 0 && query && (
                <li className="empty">
                  No matches. Try a shorter word{kinds.size > 0 ? ' or turn a chip off' : ''}.
                </li>
              )}
              {projectEntries.length > 0 && visible.length === 0 && !query && kinds.size > 0 && (
                <li className="empty">No entries of these kinds. Turn a chip off to see more.</li>
              )}
            </ul>
            {projectEntries.length === 0 && !query && <Welcome hasProject />}
            <section className="inject">
              <h2>📋 Copy for your AI chat</h2>
              <p>
                {chosen.length} selected · ~{tokenCount} tokens <CountNote exact={counter !== null} />
              </p>
              <div className="budget">
                <label>
                  Model
                  <select
                    value={modelId}
                    onChange={(e) => {
                      setModelId(e.target.value)
                      setAutoPick(null)
                    }}
                  >
                    {MODEL_PROFILES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value={CUSTOM_MODEL_ID}>Custom</option>
                  </select>
                </label>
                {modelId === CUSTOM_MODEL_ID && (
                  <label>
                    Context window (tokens)
                    <input
                      type="number"
                      min={1000}
                      step={1}
                      value={customWindow}
                      aria-invalid={contextTokens === null}
                      onChange={(e) => {
                        setCustomWindow(e.target.value)
                        setAutoPick(null)
                      }}
                    />
                  </label>
                )}
                <label>
                  Share of window
                  <select
                    value={share}
                    onChange={(e) => {
                      setShare(Number(e.target.value))
                      setAutoPick(null)
                    }}
                  >
                    {BUDGET_SHARES.map((s) => (
                      <option key={s} value={s}>
                        {Math.round(s * 100)}%
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Task
                  <input
                    type="text"
                    value={task}
                    placeholder="What are you working on?"
                    onChange={(e) => {
                      setTask(e.target.value)
                      setAutoPick(null)
                    }}
                  />
                </label>
                <button disabled={budget === null} onClick={runAutoPick}>
                  Auto-pick
                </button>
              </div>
              {autoPick && (
                <div className="budget-result">
                  <p role="status">
                    {autoPick.selection.included.length} of {autoPick.total} included, ~
                    {autoPick.selection.tokens} of {autoPick.budget} tokens{' '}
                    <CountNote exact={autoPick.exact} />
                  </p>
                  {autoPick.selection.overBudget && (
                    <p role="alert" className="notice">
                      Pinned entries alone are over this budget. Untick some, or pick a larger model.
                    </p>
                  )}
                  {autoPick.selection.dropped.length > 0 && (
                    <>
                      <h3>Left out ({autoPick.selection.dropped.length})</h3>
                      <ul className="left-out">
                        {autoPick.selection.dropped.map((e) => (
                          <li key={e.id}>{e.title}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {autoPick.unticked.length > 0 && (
                    <>
                      <h3>Left out (you unticked) ({autoPick.unticked.length})</h3>
                      <ul className="left-out unticked">
                        {autoPick.unticked.map((e) => (
                          <li key={e.id}>{e.title}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              <pre>{chosen.length ? context : 'Tick entries above to build a paste-ready block.'}</pre>
              <div className="row">
                <button className="primary" disabled={!chosen.length} onClick={copy}>
                  📋 Copy to clipboard
                </button>
                <button
                  onClick={() => {
                    setAutoPick(null)
                    setSelected(new Set(visible.map((e) => e.id)))
                    setHand((h) => {
                      const shown = new Set(visible.map((e) => e.id))
                      return new Map([...h].filter(([id, ticked]) => !ticked && !shown.has(id)))
                    })
                  }}
                >
                  Select all
                </button>
              </div>
              <div className="picks">
                <h3>Saved picks</h3>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void savePick()
                  }}
                >
                  <input
                    type="text"
                    aria-label="Pick name"
                    placeholder="Name this pick"
                    value={pickName}
                    onChange={(e) => setPickName(e.target.value)}
                  />
                  <button type="submit">
                    {picks.some((p) => sameName(p.name, pickName)) ? 'Update pick' : 'Save pick'}
                  </button>
                </form>
                {picks.some((p) => sameName(p.name, pickName)) && (
                  <p className="hint">A pick with this name exists here. Saving replaces its entries.</p>
                )}
                {picks.length === 0 ? (
                  <p className="hint">No saved picks in this project yet.</p>
                ) : (
                  <ul className="pick-list">
                    {picks.map((p) => (
                      <li key={p.id}>
                        <span>
                          {p.name} <span className="hint">{entriesText(p.entryIds.length)}</span>
                        </span>
                        <div className="row">
                          <button aria-label={`Load pick ${p.name}`} onClick={() => loadPick(p)}>
                            Load
                          </button>
                          <button
                            className="danger"
                            aria-label={`Delete pick ${p.name}`}
                            onClick={() => confirm(`Delete the pick "${p.name}"?`) && store.removePick(p.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
        {applyUpdate && (
          <p role="status" className="notice update">
            Update available. <button onClick={applyUpdate}>Reload to update</button>
          </p>
        )}
        {notice && (
          <p role="status" className="notice" key={notice}>
            {notice}
          </p>
        )}
      </main>

      {editing && project && (
        <EntryDialog
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            await store.saveEntry({ ...v, id: editing.id, projectId: project.id })
            setEditing(null)
          }}
        />
      )}
      {importing && project && (
        <ImportDialog
          onCancel={() => {
            if (!importSaving) setImporting(false)
          }}
          onSave={saveDrafts}
        />
      )}
    </div>
  )
}

/**
 * Handlers for a dialog's overlay. The overlay closes only when the press also started on the overlay.
 * A text-selection drag that starts inside the form and ends on the overlay fires a click on the overlay,
 * and that click must not close the dialog. Every mousedown overwrites the record, so a press that never
 * got a click cannot leave a stale value behind.
 */
function useOverlayDismiss(onCancel: () => void) {
  const pressedOnOverlay = useRef(false)
  return {
    onMouseDown: (e: MouseEvent<HTMLDivElement>) => {
      pressedOnOverlay.current = e.target === e.currentTarget
    },
    onClick: () => {
      const started = pressedOnOverlay.current
      pressedOnOverlay.current = false
      if (started) onCancel()
    },
  }
}

function EntryDialog(props: {
  initial: Partial<Entry>
  onCancel: () => void
  onSave: (v: { kind: EntryKind; title: string; body: string }) => void
}) {
  const [kind, setKind] = useState<EntryKind>(props.initial.kind ?? 'fact')
  const [title, setTitle] = useState(props.initial.title ?? '')
  const [body, setBody] = useState(props.initial.body ?? '')
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const overlay = useOverlayDismiss(props.onCancel)
  return (
    <div className="overlay" {...overlay}>
      <form
        role="dialog"
        aria-label="Entry"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) {
            setError('Title is required')
            titleRef.current?.focus()
            return
          }
          props.onSave({ kind, title: title.trim(), body })
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>
          {ENTRY_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_ICON[k]} {k}
            </option>
          ))}
        </select>
        <p className="hint">{KIND_HELP[kind]}</p>
        <input
          ref={titleRef}
          autoFocus
          placeholder="Title"
          value={title}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setTitle(e.target.value)
            setError('')
          }}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <textarea placeholder="Details" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row">
          <button type="submit" className="primary">
            Save
          </button>
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

const NOTHING_TO_IMPORT =
  'Nothing to import. Paste a chat summary with headings, bullets, paragraphs or code blocks.'

/** Shown on the paste step when no whole line fits within the character cap, so nothing was read. */
const TOO_LONG_LINE = `This paste has a single line longer than ${MAX_INPUT_CHARS.toLocaleString('en-US')} characters, so nothing was imported. Break it into shorter lines or paragraphs and paste it again.`

/** Shown on the review step when a cap cut the paste short. */
const CUT_MESSAGE: Record<'drafts' | 'chars', string> = {
  drafts: `Only the first ${MAX_DRAFTS} drafts were read; the rest of the paste was skipped.`,
  chars: `Only the first ${MAX_INPUT_CHARS.toLocaleString('en-US')} characters were read, up to the last whole line; the rest of the paste was skipped.`,
}

/** A draft in the preview. Its key stays the same while it is edited, so the card keeps its place. */
type Card = Draft & { key: number }

/**
 * Paste a chat summary, preview the drafts it splits into, then save the ones kept. Step one is the
 * paste box. Step two lists one editable card per draft. Saving is the parent's job, and it returns how
 * many drafts were saved, so a failure partway leaves the rest here to save again.
 */
function ImportDialog(props: {
  onCancel: () => void
  onSave: (kept: Draft[]) => Promise<{ saved: number; error?: string }>
}) {
  const [text, setText] = useState('')
  const [cards, setCards] = useState<Card[] | null>(null)
  const [message, setMessage] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const [cut, setCut] = useState<'drafts' | 'chars' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reviewing = cards !== null
  // onCancel is the parent's guarded handler, so an overlay click during a save does nothing here either.
  const overlay = useOverlayDismiss(props.onCancel)

  useEffect(() => {
    if (reviewing) headingRef.current?.focus()
  }, [reviewing])

  const preview = (e: FormEvent) => {
    e.preventDefault()
    const { drafts, truncated } = parseChatSummaryDetailed(text)
    // The too-long case has its own message on this step, and no review step, so it is not kept as a cut.
    setCut(truncated === 'line' ? null : truncated)
    if (drafts.length === 0) {
      setMessage(truncated === 'line' ? TOO_LONG_LINE : NOTHING_TO_IMPORT)
      return
    }
    setMessage('')
    setAttempted(false)
    setFailure('')
    setCards(drafts.map((d, key) => ({ ...d, key })))
  }

  const edit = (key: number, patch: Partial<Draft>) =>
    setCards((cs) => cs?.map((c) => (c.key === key ? { ...c, ...patch } : c)) ?? null)

  const drop = (key: number) => setCards((cs) => cs?.filter((c) => c.key !== key) ?? null)

  // Saving is the Save button's click only. Enter in a title input makes the browser submit the form, so
  // the review step ignores submits. Enter inside a text box is still a normal key press.
  const keepOpen = (e: FormEvent) => e.preventDefault()

  const save = async () => {
    if (!cards || cards.length === 0 || saving) return
    if (cards.some((c) => !c.title.trim())) {
      setAttempted(true)
      formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()
      return
    }
    setSaving(true)
    setFailure('')
    const kept = cards.map(({ kind, title, body }) => ({ kind, title: title.trim(), body }))
    const result = await props.onSave(kept)
    if (!result.error) return
    // Stopped partway: the saved drafts leave the list, and the rest stay so they can be saved again.
    setSaving(false)
    setFailure(
      `Saved ${result.saved} of ${kept.length} entries, then this failed: ${result.error}. The rest are still listed.`,
    )
    setCards((cs) => cs?.slice(result.saved) ?? null)
  }

  return (
    <div className="overlay" {...overlay}>
      <form
        ref={formRef}
        className="import"
        role="dialog"
        aria-label="Import from chat"
        onClick={(e) => e.stopPropagation()}
        onSubmit={cards ? keepOpen : preview}
      >
        {cards ? (
          <>
            <h3 ref={headingRef} tabIndex={-1}>
              {cards.length === 1 ? '1 draft' : `${cards.length} drafts`}
            </h3>
            <p className="hint">
              Check each draft, because guessed kinds are often wrong. Back keeps your pasted text, but edits
              made here are replaced when you preview again.
            </p>
            {cut && (
              <p role="status" className="hint">
                {CUT_MESSAGE[cut]}
              </p>
            )}
            <ul className="draft-list">
              {cards.map((c, n) => {
                const untitled = attempted && !c.title.trim()
                return (
                  <li key={c.key} className={`kind-${c.kind}`}>
                    <label>
                      Title
                      <input
                        value={c.title}
                        disabled={saving}
                        aria-invalid={untitled ? true : undefined}
                        onChange={(e) => edit(c.key, { title: e.target.value })}
                      />
                    </label>
                    {untitled && <p className="error">Title is required</p>}
                    <label>
                      Kind
                      <select
                        value={c.kind}
                        disabled={saving}
                        onChange={(e) => edit(c.key, { kind: e.target.value as EntryKind })}
                      >
                        {ENTRY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {KIND_ICON[k]} {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Details
                      <textarea
                        rows={3}
                        value={c.body}
                        disabled={saving}
                        onChange={(e) => edit(c.key, { body: e.target.value })}
                      />
                    </label>
                    <div className="row">
                      <button
                        type="button"
                        className="danger"
                        aria-label={`Drop draft ${n + 1}`}
                        disabled={saving}
                        onClick={() => drop(c.key)}
                      >
                        Drop
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {cards.length === 0 && (
              <p className="hint">Every draft is dropped. Go back to paste more, or cancel.</p>
            )}
            {failure && (
              <p role="alert" className="error">
                {failure}
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={cards.length === 0 || saving}
                onClick={save}
              >
                {`Save ${entriesText(cards.length)}`}
              </button>
              <button type="button" disabled={saving} onClick={() => setCards(null)}>
                Back
              </button>
              <button type="button" disabled={saving} onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Import from chat</h3>
            <p className="hint">
              Recognized: <code># headings</code>, bullets (<code>-</code>, <code>*</code>, <code>+</code>,{' '}
              <code>1.</code>), paragraphs and <code>```</code> code blocks. Nothing leaves your browser, and
              no AI is used.
            </p>
            <textarea
              autoFocus
              rows={12}
              aria-label="Chat summary"
              placeholder="Paste a chat summary here"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {message && (
              <p role="alert" className="error">
                {message}
              </p>
            )}
            <div className="row">
              <button type="submit" className="primary">
                Preview
              </button>
              <button type="button" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
