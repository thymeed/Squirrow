import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LAST_EXPORT_KEY,
  NUDGE_DISMISSED_KEY,
  dismissedUntilFrom,
  readStoredTime,
  shouldShowBackupNudge,
  writeStoredTime,
} from '../core/backup'
import { buildContext, estimateTokens, selectContext, type Selection } from '../core/inject'
import { exportJson, exportMarkdown, parseSnapshot } from '../core/portability'
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
} from '../core/types'
import { useUpdateReady } from './useUpdateReady'

interface AutoPick {
  selection: Selection
  unticked: Entry[]
  total: number
  budget: number
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
  const [notice, setNotice] = useState('')
  const [lastExportAt, setLastExportAt] = useState(() => readStoredTime(LAST_EXPORT_KEY))
  const [dismissedUntil, setDismissedUntil] = useState(() => readStoredTime(NUDGE_DISMISSED_KEY))
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
  const context = project ? buildContext(project, chosen) : ''

  useEffect(() => {
    setSelected(new Set())
    setHand(new Map())
    setKinds(new Set())
  }, [project?.id])

  useEffect(() => {
    setAutoPick(null)
  }, [project?.id, projectEntries])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const typing =
        ev.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)
      if (ev.key === 'Escape') setEditing(null)
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return
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
  }, [project])

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
    const selection = selectContext(project, candidates, task, budget, pinned)
    setSelected(new Set(selection.included.map((e) => e.id)))
    setAutoPick({ selection, unticked, total: projectEntries.length, budget })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(context)
      setNotice(`Copied ~${estimateTokens(context)} tokens`)
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
                {chosen.length} selected · ~{estimateTokens(context)} tokens
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
                    {autoPick.selection.tokens} of {autoPick.budget} tokens
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
    </div>
  )
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
  return (
    <div className="overlay" onClick={props.onCancel}>
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
