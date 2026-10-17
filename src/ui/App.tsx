import { useEffect, useMemo, useRef, useState } from 'react'
import { buildContext, estimateTokens } from '../core/inject'
import { exportJson, exportMarkdown, parseSnapshot } from '../core/portability'
import { searchEntries } from '../core/search'
import { useStore } from '../core/store'
import { ENTRY_KINDS, type Entry, type EntryKind, type Id } from '../core/types'

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
        🧠
      </div>
      <h2>{hasProject ? 'Nothing saved here yet' : 'Welcome to Context Keeper'}</h2>
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
  URL.revokeObjectURL(a.href)
}

export function App() {
  const store = useStore()
  const { data } = store
  const [projectId, setProjectId] = useState<Id | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<Id>>(new Set())
  const [editing, setEditing] = useState<Partial<Entry> | null>(null)
  const [notice, setNotice] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const project = data.projects.find((p) => p.id === projectId) ?? data.projects[0] ?? null
  const visible = useMemo(
    () =>
      searchEntries(
        data.entries.filter((e) => e.projectId === project?.id),
        query,
      ),
    [data.entries, project?.id, query],
  )
  const chosen = visible.filter((e) => selected.has(e.id))
  const context = project ? buildContext(project, chosen) : ''

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const typing =
        ev.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)
      if (ev.key === 'Escape') setEditing(null)
      if (typing) return
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

  const toggle = (id: Id) =>
    setSelected((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const addProject = async () => {
    const name = prompt('Project name')?.trim()
    if (name) setProjectId(await store.addProject(name))
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(context)
      setNotice(`Copied ~${estimateTokens(context)} tokens`)
    } catch {
      setNotice("Couldn't copy. Your browser blocked the clipboard, so select the text below and copy it.")
    }
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

  return (
    <div className="app">
      <aside>
        <h1>
          <span aria-hidden="true">🧠</span> Context Keeper
        </h1>
        <p className="tag">Local-first memory for your AI chats. Nothing leaves this browser.</p>
        <ul className="projects">
          {data.projects.map((p) => (
            <li key={p.id}>
              <button
                className={p.id === project?.id ? 'on' : ''}
                onClick={() => {
                  setProjectId(p.id)
                  setSelected(new Set())
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
          <button onClick={() => download('context-keeper.json', exportJson(data), 'application/json')}>
            ⬇ Export JSON
          </button>
          <button onClick={() => download('context-keeper.md', exportMarkdown(data), 'text/markdown')}>
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
              {visible.length === 0 && query && <li className="empty">No matches. Try a shorter word.</li>}
            </ul>
            {visible.length === 0 && !query && <Welcome hasProject />}
            <section className="inject">
              <h2>📋 Copy for your AI chat</h2>
              <p>
                {chosen.length} selected · ~{estimateTokens(context)} tokens
              </p>
              <pre>{chosen.length ? context : 'Tick entries above to build a paste-ready block.'}</pre>
              <div className="row">
                <button className="primary" disabled={!chosen.length} onClick={copy}>
                  📋 Copy to clipboard
                </button>
                <button onClick={() => setSelected(new Set(visible.map((e) => e.id)))}>Select all</button>
              </div>
            </section>
          </>
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
