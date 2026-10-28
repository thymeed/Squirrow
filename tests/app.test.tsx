import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { openDB } from 'idb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIRST_ENTRY_SEEN_KEY, LAST_EXPORT_KEY } from '../src/core/backup'
import { estimateTokens, type TokenCounter } from '../src/core/inject'
import { newId, type EntryKind } from '../src/core/types'
import { App } from '../src/ui/App'
import { useUpdateReady } from '../src/ui/useUpdateReady'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Each App mount asks for the tokenizer once. Tests settle that request with `finish`, so a
// test decides whether the real count, the estimate, or a fake counter is in use.
const tokenizer = vi.hoisted(() => ({
  finish: (_counter: TokenCounter | null) => {},
}))
vi.mock('../src/core/inject', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/inject')>()
  return {
    ...actual,
    loadTokenCounter: () =>
      new Promise<TokenCounter | null>((resolve) => {
        tokenizer.finish = resolve
      }),
  }
})

let root: Root
let host: HTMLDivElement

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await settle()
  }
  throw new Error(`Timed out. Page text: ${host.textContent}`)
}

const text = () => host.textContent ?? ''

const button = (label: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
  if (!found) throw new Error(`No button "${label}"`)
  return found
}

const click = (el: HTMLElement) => act(async () => el.click())

/** Dispatches a bubbling mouse event on exactly this element, the way a real press does. */
const mouseEvent = (el: Element, type: 'mousedown' | 'click') =>
  act(async () => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })))

/** The Save button of the open entry dialog. The page also has a "Save pick" button, so plain text would be ambiguous. */
const dialogSave = () => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent === 'Save',
  )
  if (!found) throw new Error('No Save button in the dialog')
  return found
}

/** Sets a controlled input's value the way a user typing would, so React sees the change. */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function addProject(name: string) {
  vi.stubGlobal('prompt', () => name)
  await click(button('New project'))
  await until(() => !!host.querySelector('.projects button.on'))
}

async function addEntry(title: string, body = '', kind: EntryKind = 'fact') {
  await click(button('+ Entry'))
  await act(async () => {
    type(host.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, title)
    type(host.querySelector('textarea')!, body)
  })
  if (kind !== 'fact') await choose(host.querySelector<HTMLSelectElement>('[role="dialog"] select')!, kind)
  await click(dialogSave())
  await until(() => !host.querySelector('[role="dialog"]'))
}

const tick = (title: string) => {
  const label = [...host.querySelectorAll('.entries label')].find((l) => l.textContent?.includes(title))
  return click(label!.querySelector('input')!)
}

/** The entry titles currently listed, in order. */
const shown = () => [...host.querySelectorAll('.entries strong')].map((s) => s.textContent)

/** The kind chip whose label contains the given kind name. */
const chip = (kind: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.kind-filter button')].find((b) =>
    b.textContent?.includes(kind),
  )
  if (!found) throw new Error(`No kind chip "${kind}"`)
  return found
}

/** The name of the project currently open in the sidebar. */
const activeProject = () => host.querySelector('.projects button.on')?.textContent

/** Opens a project from the sidebar list by its name. */
const openProject = (name: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.projects button')].find(
    (b) => b.textContent === name,
  )
  if (!found) throw new Error(`No project "${name}"`)
  return click(found)
}

const ticked = () =>
  [...host.querySelectorAll<HTMLLabelElement>('.entries label')]
    .filter((l) => l.querySelector('input')!.checked)
    .map((l) => l.textContent)

/** Picks an option the way a user would, so React sees the change. */
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

const modelSelect = () => host.querySelectorAll<HTMLSelectElement>('.budget select')[0]!
const searchInput = () => host.querySelector<HTMLInputElement>('input[placeholder="Search entries ( / )"]')!
const customInput = () => host.querySelector<HTMLInputElement>('.budget input[type="number"]')!
const taskInput = () => host.querySelector<HTMLInputElement>('input[placeholder="What are you working on?"]')!

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
  await until(() => !text().includes('Loading'))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('update prompt', () => {
  const remount = async () => {
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<App />))
    await until(() => !text().includes('Loading'))
  }
  const fakeServiceWorker = (waiting: { postMessage: () => void; state: string } | null) => {
    const sw = Object.assign(new EventTarget(), {
      controller: {},
      ready: Promise.resolve(
        Object.assign(new EventTarget(), { waiting, installing: null, update: async () => {} }),
      ),
    })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
    return sw
  }
  afterEach(() => Reflect.deleteProperty(navigator, 'serviceWorker'))

  it('shows nothing when no update is waiting', async () => {
    fakeServiceWorker(null)
    await remount()
    await settle()
    expect(text()).not.toContain('Update available')
  })

  it('checks for updates once, not on every render', async () => {
    const sw = fakeServiceWorker(null)
    const reg = await sw.ready
    const update = vi.fn(async () => {})
    Object.assign(reg, { update })
    await remount()
    await settle()
    await addProject('P')
    type(host.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="earch"]')!, 'abc')
    await settle()
    expect(update).toHaveBeenCalledOnce()
  })

  it('offers an update whose worker is still installing, once it finishes', async () => {
    const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() })
    const sw = fakeServiceWorker(null)
    const reg = await sw.ready
    Object.assign(reg, { installing: worker })
    await remount()
    await settle()
    expect(text()).not.toContain('Update available')
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    await until(() => text().includes('Update available'))
  })

  it('reloads every tab when a new worker takes over, but not on a first install', async () => {
    function Probe({ reload }: { reload: () => void }) {
      useUpdateReady(reload)
      return null
    }
    const mount = async (controller: object | null) => {
      const sw = Object.assign(new EventTarget(), { controller, ready: new Promise(() => {}) })
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
      const reload = vi.fn()
      const el = document.createElement('div')
      const r = createRoot(el)
      await act(async () => r.render(<Probe reload={reload} />))
      sw.dispatchEvent(new Event('controllerchange'))
      await act(async () => r.unmount())
      return reload
    }
    expect(await mount({})).toHaveBeenCalledOnce()
    expect(await mount(null)).not.toHaveBeenCalled()
  })

  it('offers a waiting update and asks the worker to take over only after a click', async () => {
    const postMessage = vi.fn()
    fakeServiceWorker({ postMessage, state: 'installed' })
    await remount()
    await until(() => text().includes('Update available'))
    expect(postMessage).not.toHaveBeenCalled()
    await click(button('Reload to update'))
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })
})

describe('auto-pick status', () => {
  it('goes away when a new project opens or an entry changes', async () => {
    await addProject('First')
    await addEntry('Alpha')
    await click(button('Auto-pick'))
    expect(text()).toContain('included')
    await addEntry('Beta')
    await until(() => !text().includes('included'))
    await click(button('Auto-pick'))
    expect(text()).toContain('included')
    await addProject('Second')
    await until(() => !text().includes('included'))
  })
})

describe('kind filter', () => {
  it('shows only the entries of a chosen kind, and everything again when none is chosen', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    await addEntry('Chose Vite', '', 'decision')
    await addEntry('helper', 'x = 1', 'snippet')
    expect(shown()).toEqual(['Use Postgres', 'Chose Vite', 'helper'])
    await click(chip('decision'))
    expect(shown()).toEqual(['Chose Vite'])
    expect(chip('decision').getAttribute('aria-pressed')).toBe('true')
    await click(chip('decision'))
    expect(shown()).toEqual(['Use Postgres', 'Chose Vite', 'helper'])
    expect(chip('decision').getAttribute('aria-pressed')).toBe('false')
  })

  it('combines several chips as a union', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    await addEntry('Chose Vite', '', 'decision')
    await addEntry('helper', 'x = 1', 'snippet')
    await click(chip('fact'))
    await click(chip('snippet'))
    expect(shown()).toEqual(['Use Postgres', 'helper'])
    expect(chip('decision').getAttribute('aria-pressed')).toBe('false')
  })

  it('applies the kind chips and the search together', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    await addEntry('Postgres style', '', 'preference')
    await addEntry('Redis cache')
    await click(chip('fact'))
    await act(async () => type(searchInput(), 'postgres'))
    expect(shown()).toEqual(['Use Postgres'])
    await click(chip('fact'))
    expect(shown()).toEqual(['Postgres style', 'Use Postgres'])
    await click(chip('preference'))
    await act(async () => type(searchInput(), 'redis'))
    expect(shown()).toEqual([])
    expect(text()).toContain('No matches')
    expect(text()).not.toContain('Nothing saved here yet')
  })

  it('keeps the empty-project guide when a chip is turned on in an empty project', async () => {
    await addProject('Demo')
    await click(chip('decision'))
    expect(text()).toContain('Nothing saved here yet')
    expect(text()).not.toContain('No entries of these kinds')
  })

  it('explains an empty kind filter without showing the welcome guide', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    await click(chip('file-note'))
    expect(shown()).toEqual([])
    expect(text()).toContain('No entries of these kinds')
    expect(text()).not.toContain('Nothing saved here yet')
  })

  it('shows the empty-project guide, not the kind message, when a chip is on in an empty project', async () => {
    await addProject('A')
    await addEntry('Use Postgres')
    await click(chip('decision'))
    await addProject('B')
    await until(() => activeProject() === 'B')
    expect(text()).toContain('Nothing saved here yet')
    expect(text()).not.toContain('No entries of these kinds')
  })

  it('turns the chips off when switching projects, and keeps them off when coming back', async () => {
    await addProject('A')
    await addEntry('Use Postgres')
    await addEntry('Chose Vite', '', 'decision')
    await click(chip('decision'))
    expect(shown()).toEqual(['Chose Vite'])
    await addProject('B')
    await until(() => activeProject() === 'B')
    expect(chip('decision').getAttribute('aria-pressed')).toBe('false')
    await openProject('A')
    expect(chip('decision').getAttribute('aria-pressed')).toBe('false')
    expect(shown()).toEqual(['Use Postgres', 'Chose Vite'])
  })
})

describe('app smoke', () => {
  it('shows the welcome guide on first load', () => {
    expect(text()).toContain('Welcome to Squirrow')
  })

  it('creates a project and an entry', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    expect(host.querySelector('.entries')!.textContent).toContain('Use Postgres')
  })

  it('copies the ticked entries as Markdown', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await tick('Use Postgres')
    await click(button('Copy to clipboard'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('- **Use Postgres**: version 16'))
    expect(text()).toContain('Copied ~')
  })

  it('keeps ticked entries in the copy while a search hides them', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await tick('Alpha')
    await act(async () => type(host.querySelector<HTMLInputElement>('.bar input')!, 'beta'))
    await tick('Beta')
    expect(text()).toContain('2 selected')
    expect(host.querySelector('.inject pre')!.textContent).toContain('**Alpha**')
  })

  it('opens a new entry on n but leaves Ctrl+N and Cmd+N to the browser', async () => {
    await addProject('Demo')
    const press = (init: KeyboardEventInit) =>
      act(async () =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', cancelable: true, ...init })),
      )
    await press({ ctrlKey: true })
    await press({ metaKey: true })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    await press({})
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('keeps the export link alive until the download has started', async () => {
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => 'blob:export'
        static revokeObjectURL = revoke
      },
    )
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      await click(button('Export JSON'))
      expect(clicked).toHaveBeenCalled()
      expect(revoke).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:export')
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the user when the clipboard refuses the copy', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    await addProject('Demo')
    await addEntry('Use Postgres')
    await tick('Use Postgres')
    await click(button('Copy to clipboard'))
    await until(() => text().includes("Couldn't copy"))
    expect(text()).not.toContain('Copied ~')
  })

  it('auto-picks what fits the small model, lists the rest as left out, and clears that list on a manual tick', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    const model = host.querySelector<HTMLSelectElement>('.budget select')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(model, 'small')
      model.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button('Auto-pick'))
    await until(() => text().includes('Left out (1)'))
    expect(host.querySelector('.left-out')!.textContent).toBe('Big notes')
    expect(text()).toContain('1 of 2 included')
    expect(ticked()).toEqual([expect.stringContaining('Use Postgres')])
    await tick('Big notes')
    expect(text()).not.toContain('Left out')
  })

  it('shrinks an earlier Auto-pick when a smaller model is picked', async () => {
    await addProject('Demo')
    for (let i = 1; i <= 10; i++) await addEntry(`Note ${i}`, 'x'.repeat(400))
    await click(button('Auto-pick'))
    await until(() => text().includes('10 of 10 included'))
    await choose(modelSelect(), 'small')
    await click(button('Auto-pick'))
    await until(() => text().includes('Left out'))
    expect(text()).not.toContain('Pinned entries alone are over this budget')
    expect(ticked().length).toBeLessThan(10)
    expect(text()).toMatch(/\d+ of 10 included/)
  })

  it('re-ranks the entries when the task changes', async () => {
    await addProject('Demo')
    await addEntry('Postgres setup', 'x'.repeat(2000))
    await addEntry('Redis cache', 'y'.repeat(2000))
    await choose(modelSelect(), 'small')
    await act(async () => type(taskInput(), 'postgres'))
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(ticked()).toEqual([expect.stringContaining('Postgres setup')])
    await act(async () => type(taskInput(), 'redis'))
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(ticked()).toEqual([expect.stringContaining('Redis cache')])
  })

  it('keeps an entry the user unticked after Auto-pick out of the next Auto-pick', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    await click(button('Auto-pick'))
    await until(() => text().includes('2 of 2 included'))
    await tick('Big notes')
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(ticked()).toEqual([expect.stringContaining('Use Postgres')])
  })

  it('lists an entry the user unticked under its own heading, so the counts add up', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    await click(button('Auto-pick'))
    await until(() => text().includes('2 of 2 included'))
    await tick('Big notes')
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(text()).toContain('Left out (you unticked) (1)')
    expect(host.querySelector('.unticked')!.textContent).toBe('Big notes')
  })

  it('keeps a hand-ticked entry through Auto-pick and warns when ticked entries alone exceed the budget', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    await tick('Big notes')
    await click(button('Auto-pick'))
    await until(() => text().includes('2 of 2 included'))
    await choose(modelSelect(), 'small')
    await click(button('Auto-pick'))
    await until(() => !!host.querySelector('[role="alert"]'))
    expect(ticked()).toEqual([expect.stringContaining('Big notes')])
    expect(text()).toContain('1 of 2 included')
  })

  it('does not pin what Select all ticked, so a smaller model can shrink the Auto-pick', async () => {
    await addProject('Demo')
    for (let i = 1; i <= 10; i++) await addEntry(`Note ${i}`, 'x'.repeat(400))
    await click(button('Select all'))
    await until(() => ticked().length === 10)
    await choose(modelSelect(), 'small')
    await click(button('Auto-pick'))
    await until(() => /\d+ of 10 included/.test(text()))
    expect(ticked().length).toBeLessThan(10)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('remembers an entry the user unticked while a filter hid it, through a later Select all', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    await click(button('Auto-pick'))
    await until(() => text().includes('2 of 2 included'))
    await tick('Big notes')
    await act(async () => type(searchInput(), 'postgres'))
    await click(button('Select all'))
    await act(async () => type(searchInput(), ''))
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(ticked()).toEqual([expect.stringContaining('Use Postgres')])
  })

  it('drops a hand tick from a hidden entry when Select all replaces the ticked set', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    await tick('Big notes')
    await act(async () => type(searchInput(), 'postgres'))
    await click(button('Select all'))
    await act(async () => type(searchInput(), ''))
    await until(() => ticked().length === 1)
    await choose(modelSelect(), 'small')
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(ticked()).toEqual([expect.stringContaining('Use Postgres')])
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('budgets from a custom context window and shows it in the status', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await choose(modelSelect(), 'custom')
    expect(customInput().value).toBe('32000')
    await act(async () => type(customInput(), '2000'))
    await click(button('Auto-pick'))
    await until(() => text().includes('of 200 tokens'))
  })

  it('disables Auto-pick when the custom window is not a whole number of at least 1000', async () => {
    await addProject('Demo')
    await choose(modelSelect(), 'custom')
    await act(async () => type(customInput(), '500'))
    expect(customInput().getAttribute('aria-invalid')).toBe('true')
    expect(button('Auto-pick').disabled).toBe(true)
    await act(async () => type(customInput(), '1500.5'))
    expect(button('Auto-pick').disabled).toBe(true)
    await act(async () => type(customInput(), '1000'))
    expect(customInput().getAttribute('aria-invalid')).toBe('false')
    expect(button('Auto-pick').disabled).toBe(false)
  })

  it('clears the included count when the model changes', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 1 included'))
    await choose(modelSelect(), 'gpt')
    expect(text()).not.toContain('of 1 included')
  })

  it('shows a readable error when an import file is invalid', async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['nope'], 'bad.json')] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await until(() => text().includes('File is not valid JSON'))
  })
})

describe('backup reminder', () => {
  const DAY = 24 * 60 * 60 * 1000
  const banner = () => host.querySelector<HTMLElement>('.nudge')
  const bannerButton = (label: string) => {
    const found = [...banner()!.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
    if (!found) throw new Error(`No banner button "${label}"`)
    return found
  }
  const stubDownload = () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => 'blob:export'
        static revokeObjectURL = () => {}
      },
    )
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  }
  /** Unmounts and mounts the app again, like a page reload. Data and localStorage survive. */
  const reload = async () => {
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<App />))
    await until(() => !text().includes('Loading'))
  }

  /** Makes entries look first seen `days` ago, then reloads so the app reads the stored time. */
  const seenAgo = async (days: number) => {
    localStorage.setItem(FIRST_ENTRY_SEEN_KEY, String(Date.now() - days * DAY))
    await reload()
  }

  it('stays hidden for a new user, then shows once the first entry is 15 days old', async () => {
    await addProject('Demo')
    expect(localStorage.getItem(FIRST_ENTRY_SEEN_KEY)).toBeNull()
    await addEntry('Use Postgres')
    expect(banner()).toBeNull()
    const firstSeen = localStorage.getItem(FIRST_ENTRY_SEEN_KEY)
    expect(firstSeen).not.toBeNull()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * DAY)
    await reload()
    expect(banner()!.textContent).toContain("You haven't backed up lately")
    expect(localStorage.getItem(FIRST_ENTRY_SEEN_KEY)).toBe(firstSeen)
  })

  it('does not move the first-seen time when the entry is edited', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    const firstSeen = localStorage.getItem(FIRST_ENTRY_SEEN_KEY)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * DAY)
    await click(button('Edit'))
    await act(async () =>
      type(host.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'Use Postgres 16'),
    )
    await click(dialogSave())
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(localStorage.getItem(FIRST_ENTRY_SEEN_KEY)).toBe(firstSeen)
  })

  it('records the first-seen time for an existing user who has none stored, without a banner', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    localStorage.removeItem(FIRST_ENTRY_SEEN_KEY)
    await reload()
    expect(banner()).toBeNull()
    expect(localStorage.getItem(FIRST_ENTRY_SEEN_KEY)).not.toBeNull()
  })

  it('writes no first-seen time when there are no entries', async () => {
    await addProject('Demo')
    await reload()
    expect(banner()).toBeNull()
    expect(localStorage.getItem(FIRST_ENTRY_SEEN_KEY)).toBeNull()
  })

  it('treats a garbage stored first-seen time as missing and records it again', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    localStorage.setItem(FIRST_ENTRY_SEEN_KEY, 'garbage')
    await reload()
    expect(banner()).toBeNull()
    expect(Number(localStorage.getItem(FIRST_ENTRY_SEEN_KEY))).toBeGreaterThan(0)
  })

  it('exports from the banner, hides it, and keeps it hidden after a reload', async () => {
    const clicked = stubDownload()
    await addProject('Demo')
    await addEntry('Use Postgres')
    await seenAgo(15)
    await click(bannerButton('Export'))
    expect(clicked).toHaveBeenCalledOnce()
    expect(banner()).toBeNull()
    expect(localStorage.getItem(LAST_EXPORT_KEY)).not.toBeNull()
    await reload()
    expect(banner()).toBeNull()
  })

  it('hides when Export JSON in the sidebar is used', async () => {
    stubDownload()
    await addProject('Demo')
    await addEntry('Use Postgres')
    await seenAgo(15)
    expect(banner()).not.toBeNull()
    await click(button('Export JSON'))
    expect(banner()).toBeNull()
  })

  it('does not count Export Markdown as a backup', async () => {
    stubDownload()
    await addProject('Demo')
    await addEntry('Use Postgres')
    await seenAgo(15)
    await click(button('Export Markdown'))
    expect(banner()).not.toBeNull()
    expect(localStorage.getItem(LAST_EXPORT_KEY)).toBeNull()
  })

  it('records no export time when the download fails', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => {
          throw new Error('blocked')
        }
        static revokeObjectURL = () => {}
      },
    )
    await addProject('Demo')
    await addEntry('Use Postgres')
    await seenAgo(15)
    expect(banner()).not.toBeNull()
    const expected = (e: ErrorEvent) => e.preventDefault()
    window.addEventListener('error', expected)
    try {
      await click(button('Export JSON'))
    } finally {
      window.removeEventListener('error', expected)
    }
    expect(localStorage.getItem(LAST_EXPORT_KEY)).toBeNull()
    expect(banner()).not.toBeNull()
  })

  it('hides on Dismiss for seven days, then shows again', async () => {
    const start = Date.now()
    const at = (days: number) => vi.spyOn(Date, 'now').mockReturnValue(start + days * DAY)
    await addProject('Demo')
    await addEntry('Use Postgres')
    await seenAgo(15)
    await click(bannerButton('Dismiss'))
    expect(banner()).toBeNull()
    at(6)
    await reload()
    expect(banner()).toBeNull()
    at(8)
    await reload()
    expect(banner()).not.toBeNull()
  })

  it('shows again when the last export is more than 14 days old', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres')
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now() - 15 * DAY))
    await reload()
    expect(banner()).not.toBeNull()
  })
})

describe('token counts', () => {
  // A stand-in counter that is clearly different from the 4-character estimate.
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length
  const caption = () => host.querySelector('.inject p .hint')?.textContent
  const exact = () => text().includes('GPT-style count')
  const shownCount = () => Number(host.querySelector('.inject p')!.textContent!.match(/~(\d+) tokens/)![1])

  async function copiedText() {
    const writeText = vi.fn(async (_text: string) => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await click(button('Copy to clipboard'))
    return writeText.mock.calls[0]![0]
  }

  it('shows the estimate, labelled as one, until the tokenizer has loaded', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await tick('Use Postgres')
    const written = await copiedText()
    expect(caption()).toBe('estimate')
    expect(shownCount()).toBe(estimateTokens(written))
  })

  it('shows and copies the tokenizer count once it loads, labelled GPT-style', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await tick('Use Postgres')
    tokenizer.finish(words)
    await until(exact)
    const written = await copiedText()
    expect(words(written)).not.toBe(estimateTokens(written))
    expect(shownCount()).toBe(words(written))
    expect(text()).toContain(`Copied ~${words(written)} tokens`)
  })

  it('keeps the estimate when the tokenizer fails to load', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await tick('Use Postgres')
    tokenizer.finish(null)
    const written = await copiedText()
    expect(caption()).toBe('estimate')
    expect(shownCount()).toBe(estimateTokens(written))
  })

  it('auto-picks with the loaded count, so an entry the estimate would drop fits', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    tokenizer.finish(words)
    await until(exact)
    await choose(modelSelect(), 'custom')
    await act(async () => type(customInput(), '2000'))
    await click(button('Auto-pick'))
    await until(() => text().includes('2 of 2 included'))
    expect(host.querySelector('.budget-result .hint')!.textContent).toContain('GPT-style count')
  })

  it('auto-picks with the estimate when the tokenizer fails, and labels it so', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16')
    await addEntry('Big notes', 'x'.repeat(4000))
    tokenizer.finish(null)
    await choose(modelSelect(), 'custom')
    await act(async () => type(customInput(), '2000'))
    await click(button('Auto-pick'))
    await until(() => text().includes('1 of 2 included'))
    expect(host.querySelector('.budget-result .hint')!.textContent).toBe('estimate')
  })
})

describe('saved picks', () => {
  const pickNameInput = () => host.querySelector<HTMLInputElement>('input[aria-label="Pick name"]')!
  const pickButton = (label: string) => {
    const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!found) throw new Error(`No button "${label}"`)
    return found
  }
  /** Names of the picks listed for the open project. */
  const pickNames = () =>
    [...host.querySelectorAll<HTMLButtonElement>('.pick-list button[aria-label^="Load pick "]')].map((b) =>
      b.getAttribute('aria-label')!.slice('Load pick '.length),
    )
  const typeName = (name: string) => act(async () => type(pickNameInput(), name))
  const submitPick = () => click(host.querySelector<HTMLButtonElement>('.picks form button')!)
  const deleteEntry = (title: string) => {
    const li = [...host.querySelectorAll<HTMLLIElement>('.entries > li')].find(
      (l) => l.querySelector('strong')?.textContent === title,
    )
    return click(li!.querySelector<HTMLButtonElement>('button.danger')!)
  }
  /** Stubs the download so the exported file can be read back. Returns a function that gives its text. */
  const captureExport = () => {
    let exported: Blob | undefined
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = (blob: Blob) => {
          exported = blob
          return 'blob:export'
        }
        static revokeObjectURL = () => {}
      },
    )
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return async () => exported!.text()
  }
  async function importFile(json: string) {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File([json], 'squirrow.json')], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }

  it('saves the ticked entries as a pick and loads exactly those back', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await addEntry('Gamma')
    await tick('Alpha')
    await tick('Gamma')
    await typeName('Core')
    await submitPick()
    await until(() => text().includes('Saved "Core" with 2 entries.'))
    expect(pickNames()).toEqual(['Core'])
    expect(pickNameInput().value).toBe('')
    await tick('Beta')
    await click(pickButton('Load pick Core'))
    expect(ticked()).toEqual([expect.stringContaining('Alpha'), expect.stringContaining('Gamma')])
    expect(text()).toContain('Loaded 2 entries.')
    expect(text()).not.toContain('missing')
  })

  it('skips entries deleted since the pick was saved, and says how many were missing', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await addEntry('Gamma')
    await tick('Alpha')
    await tick('Beta')
    await tick('Gamma')
    await typeName('Trio')
    await submitPick()
    await until(() => text().includes('Saved "Trio" with 3 entries.'))
    await deleteEntry('Beta')
    await until(() => !shown().includes('Beta'))
    await tick('Alpha')
    await tick('Gamma')
    expect(ticked()).toEqual([])
    await click(pickButton('Load pick Trio'))
    expect(ticked()).toEqual([expect.stringContaining('Alpha'), expect.stringContaining('Gamma')])
    expect(text()).toContain('Loaded 2 entries. 1 was missing (deleted).')
  })

  it('says so and leaves the ticks alone when every entry of a pick was deleted', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await tick('Alpha')
    await typeName('Solo')
    await submitPick()
    await until(() => text().includes('Saved "Solo" with 1 entry.'))
    await deleteEntry('Alpha')
    await until(() => !shown().includes('Alpha'))
    await tick('Beta')
    await click(pickButton('Load pick Solo'))
    await until(() => text().includes('All 1 entry in "Solo" was deleted, so nothing was ticked.'))
    expect(ticked()).toEqual([expect.stringContaining('Beta')])
  })

  it('refuses an empty name and a pick with nothing ticked, with a message each time', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await tick('Alpha')
    await typeName('   ')
    await submitPick()
    await until(() => text().includes('Give the pick a name before saving'))
    await tick('Alpha')
    await typeName('Core')
    await submitPick()
    await until(() => text().includes('Tick some entries before saving a pick'))
    expect(pickNames()).toEqual([])
    expect(text()).toContain('No saved picks in this project yet.')
  })

  it('overwrites a pick saved under the same name, and says Updated', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await tick('Alpha')
    await typeName('Core')
    await submitPick()
    await until(() => text().includes('Saved "Core" with 1 entry.'))
    await tick('Alpha')
    await tick('Beta')
    await typeName(' Core ')
    expect(button('Update pick')).toBeTruthy()
    expect(text()).toContain('A pick with this name exists here.')
    await submitPick()
    await until(() => text().includes('Updated "Core" with 1 entry.'))
    expect(pickNames()).toEqual(['Core'])
    await tick('Beta')
    await click(pickButton('Load pick Core'))
    expect(ticked()).toEqual([expect.stringContaining('Beta')])
  })

  it('treats a name that differs only in capitalization as the same pick', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await tick('Alpha')
    await typeName('Core')
    await submitPick()
    await until(() => text().includes('Saved "Core" with 1 entry.'))
    await tick('Alpha')
    await tick('Beta')
    await typeName('core')
    expect(button('Update pick')).toBeTruthy()
    await submitPick()
    await until(() => text().includes('Updated "Core" with 1 entry.'))
    expect(pickNames()).toEqual(['Core'])
  })

  it('deletes a pick only after confirmation', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await tick('Alpha')
    await typeName('Core')
    await submitPick()
    await until(() => pickNames().length === 1)
    vi.stubGlobal('confirm', () => false)
    await click(pickButton('Delete pick Core'))
    expect(pickNames()).toEqual(['Core'])
    vi.stubGlobal('confirm', () => true)
    await click(pickButton('Delete pick Core'))
    await until(() => pickNames().length === 0)
    expect(text()).toContain('No saved picks in this project yet.')
  })

  it('lists only the picks of the open project', async () => {
    await addProject('A')
    await addEntry('Alpha')
    await tick('Alpha')
    await typeName('Core')
    await submitPick()
    await until(() => pickNames().length === 1)
    await addProject('B')
    await until(() => activeProject() === 'B')
    expect(pickNames()).toEqual([])
    expect(text()).toContain('No saved picks in this project yet.')
    await openProject('A')
    expect(pickNames()).toEqual(['Core'])
  })

  it('loads a pick even when a kind chip hides some of its entries', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Chose Vite', '', 'decision')
    await tick('Alpha')
    await tick('Chose Vite')
    await typeName('Both')
    await submitPick()
    await until(() => pickNames().length === 1)
    await tick('Chose Vite')
    await click(chip('fact'))
    expect(shown()).toEqual(['Alpha'])
    await click(pickButton('Load pick Both'))
    expect(text()).toContain('2 selected')
    expect(shown()).toEqual(['Alpha'])
  })

  it('exports the picks to JSON and restores them on import', async () => {
    const exportedText = captureExport()
    vi.stubGlobal('confirm', () => true)
    await addProject('Demo')
    await addEntry('Alpha')
    await tick('Alpha')
    await typeName('Core')
    await submitPick()
    await until(() => pickNames().length === 1)
    await click(button('Export JSON'))
    const json = await exportedText()
    expect(JSON.parse(json).savedPicks).toEqual([expect.objectContaining({ name: 'Core' })])
    await click(pickButton('Delete pick Core'))
    await until(() => pickNames().length === 0)
    await importFile(json)
    await until(() => text().includes('Imported.'))
    expect(pickNames()).toEqual(['Core'])
    await tick('Alpha')
    await click(pickButton('Load pick Core'))
    expect(ticked()).toEqual([expect.stringContaining('Alpha')])
  })

  it('imports an export from before saved picks, with no picks', async () => {
    vi.stubGlobal('confirm', () => true)
    const projectId = newId()
    const entryId = newId()
    const old = JSON.stringify({
      version: 1,
      projects: [{ id: projectId, name: 'Old', createdAt: 1 }],
      entries: [{ id: entryId, projectId, kind: 'fact', title: 'Legacy note', body: '', updatedAt: 1 }],
    })
    await importFile(old)
    await until(() => text().includes('Imported.'))
    expect(shown()).toEqual(['Legacy note'])
    expect(text()).toContain('No saved picks in this project yet.')
  })

  it('keeps the loaded entries through Auto-pick, which may still add other entries', async () => {
    await addProject('Demo')
    await addEntry('Alpha')
    await addEntry('Beta')
    await addEntry('Gamma')
    await tick('Alpha')
    await tick('Beta')
    await typeName('Pair')
    await submitPick()
    await until(() => text().includes('Saved "Pair" with 2 entries.'))
    await tick('Alpha')
    expect(ticked()).toEqual([expect.stringContaining('Beta')])
    await click(pickButton('Load pick Pair'))
    expect(ticked()).toEqual([expect.stringContaining('Alpha'), expect.stringContaining('Beta')])
    await click(button('Auto-pick'))
    await until(() => text().includes('3 of 3 included'))
    expect(ticked()).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
      expect.stringContaining('Gamma'),
    ])
    expect(text()).not.toContain('Left out (you unticked)')
  })
})

describe('older tab', () => {
  const BLOCKED =
    'Squirrow is open in another tab with an older version. Close or reload that tab to continue.'

  it('says so while an older tab holds the database, then loads once that tab lets go', async () => {
    // beforeEach has already opened the current database. Start over with an older one held by another tab.
    await act(async () => root.unmount())
    globalThis.indexedDB = new IDBFactory()
    const projectId = newId()
    const older = await openDB('squirrow', 1, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('byProject', 'projectId')
      },
    })
    await older.put('projects', { id: projectId, name: 'Old', createdAt: 1 })
    await older.put('entries', {
      id: newId(),
      projectId,
      kind: 'fact',
      title: 'Legacy note',
      body: '',
      updatedAt: 1,
    })
    root = createRoot(host)
    await act(async () => root.render(<App />))
    await until(() => text().includes(BLOCKED))
    expect(text()).not.toContain('Loading')
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(BLOCKED)
    older.close()
    await until(() => !text().includes(BLOCKED))
    expect(shown()).toEqual(['Legacy note'])
  })
})

describe('import from chat', () => {
  const SUMMARY = [
    '## Stack',
    '- Vite for the build',
    '- We decided to use Postgres 16',
    '- Drop me please',
    '',
    '## Files',
    '- src/core/search.ts ranks entries',
  ].join('\n')

  /** A button of the open import dialog, matched by its exact label. */
  const importButton = (label: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (b) => b.textContent === label,
    )
    if (!found) throw new Error(`No "${label}" button in the import dialog`)
    return found
  }

  /** The title inputs of the preview cards, in order. */
  const draftTitles = () =>
    [...host.querySelectorAll<HTMLInputElement>('.draft-list li input')].map((i) => i.value)

  const paste = async (summary: string) => {
    await click(button('Import from chat'))
    await act(async () => type(host.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!, summary))
    await click(importButton('Preview'))
  }

  it('saves exactly the kept drafts, with the titles and kinds chosen in the preview', async () => {
    await addProject('Demo')
    await paste(SUMMARY)
    expect(text()).toContain('4 drafts')
    expect(text()).not.toContain('Only the first')
    expect(draftTitles()).toEqual([
      'Vite for the build',
      'We decided to use Postgres 16',
      'Drop me please',
      'src/core/search.ts ranks entries',
    ])
    expect([...host.querySelectorAll<HTMLSelectElement>('.draft-list select')].map((s) => s.value)).toEqual([
      'fact',
      'decision',
      'fact',
      'file-note',
    ])

    await act(async () => type(host.querySelectorAll<HTMLInputElement>('.draft-list li input')[0]!, 'Vite 5'))
    await choose(host.querySelectorAll<HTMLSelectElement>('.draft-list select')[0]!, 'preference')
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Drop draft 3"]')!)
    expect(draftTitles()).toEqual([
      'Vite 5',
      'We decided to use Postgres 16',
      'src/core/search.ts ranks entries',
    ])

    await click(importButton('Save 3 entries'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(shown()).toEqual(['Vite 5', 'We decided to use Postgres 16', 'src/core/search.ts ranks entries'])
    expect([...host.querySelectorAll('.entries li')].map((li) => li.className)).toEqual([
      'kind-preference',
      'kind-decision',
      'kind-file-note',
    ])
    expect(text()).toContain('Imported 3 entries.')
  })

  it('appends to the entries already in the project and leaves them as they were', async () => {
    await addProject('Demo')
    await addEntry('Use Postgres', 'version 16', 'decision')
    await paste('- Vite for the build')
    await click(importButton('Save 1 entry'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(shown()).toEqual(['Use Postgres', 'Vite for the build'])
    expect(host.querySelector('.entries li.kind-decision p')!.textContent).toBe('version 16')
  })

  it('closes on Esc without saving anything', async () => {
    await addProject('Demo')
    await paste(SUMMARY)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(shown()).toEqual([])
  })

  it('says nothing to import when the paste has only headings', async () => {
    await addProject('Demo')
    await paste('## Plan\n## Details')
    expect(text()).toContain(
      'Nothing to import. Paste a chat summary with headings, bullets, paragraphs or code blocks.',
    )
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('says in the paste-step hint that paragraphs are recognized', async () => {
    await addProject('Demo')
    await click(button('Import from chat'))
    const hint = host.querySelector('[role="dialog"] p.hint')!.textContent
    expect(hint).toContain('paragraphs')
    expect(hint).toContain('code blocks')
  })

  it('refuses a paste with one line longer than the cap, and keeps the text on the paste step', async () => {
    await addProject('Demo')
    await click(button('Import from chat'))
    const area = host.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!
    await act(async () => type(area, 'x'.repeat(250_000)))
    await click(importButton('Preview'))
    const alert = host.querySelector('[role="dialog"] [role="alert"]')!
    expect(alert.textContent).toBe(
      'This paste has a single line longer than 200,000 characters, so nothing was imported. Break it into shorter lines or paragraphs and paste it again.',
    )
    expect(text()).not.toContain('Nothing to import')
    expect(host.querySelector('[role="dialog"] textarea')).toBe(area)
    expect(area.value.length).toBe(250_000)
    expect(host.querySelector('.draft-list')).toBeNull()
  })

  it('says nothing to import, not the too-long message, for blank input past the cap', async () => {
    await addProject('Demo')
    await paste(' '.repeat(250_000))
    expect(host.querySelector('[role="dialog"] [role="alert"]')!.textContent).toBe(
      'Nothing to import. Paste a chat summary with headings, bullets, paragraphs or code blocks.',
    )
    expect(text()).not.toContain('single line longer')
  })

  it('shows neither message for a normal paste', async () => {
    await addProject('Demo')
    await paste('- Vite for the build')
    expect(draftTitles()).toEqual(['Vite for the build'])
    expect(text()).not.toContain('Nothing to import')
    expect(text()).not.toContain('single line longer')
    expect(host.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
  })

  it('Enter in a draft title does not save, and the dialog keeps the drafts', async () => {
    await addProject('Demo')
    await paste('- Alpha\n- Beta')
    const title = host.querySelectorAll<HTMLInputElement>('.draft-list li input')[0]!
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      // A browser submits the form on Enter in a text field. requestSubmit stands in for that here.
      title.form!.requestSubmit()
      // Wait for a save that wrongly started to finish, so the checks below would see it.
      await new Promise((r) => setTimeout(r, 100))
    })
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(draftTitles()).toEqual(['Alpha', 'Beta'])
    expect(shown()).toEqual([])

    await click(importButton('Save 2 entries'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(shown()).toEqual(['Alpha', 'Beta'])
  })

  it('Enter in the paste box does not start a preview, and the textarea stays', async () => {
    await addProject('Demo')
    await click(button('Import from chat'))
    const area = host.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!
    await act(async () => type(area, '- Alpha'))
    await act(async () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    // Still the paste step: no review list, the Preview button is still there, and the textarea keeps its text.
    expect(host.querySelector('[role="dialog"] textarea')).toBe(area)
    expect(area.value).toBe('- Alpha')
    expect(host.querySelector('.draft-list')).toBeNull()
    expect(importButton('Preview')).toBeTruthy()
  })

  it('disables Save once every draft is dropped', async () => {
    await addProject('Demo')
    await paste('- One\n- Two')
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Drop draft 1"]')!)
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Drop draft 1"]')!)
    expect(importButton('Save 0 entries').disabled).toBe(true)
    expect(text()).toContain('Every draft is dropped')
  })

  it('blocks a draft with an empty title, marks it, and saves nothing until it has a title', async () => {
    await addProject('Demo')
    await paste('- Vite for the build\n- Drop me')
    await act(async () => type(host.querySelector<HTMLInputElement>('.draft-list li input')!, ''))
    await click(importButton('Save 2 entries'))
    expect(text()).toContain('Title is required')
    expect(host.querySelector('.draft-list input')!.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(shown()).toEqual([])

    await act(async () => type(host.querySelector<HTMLInputElement>('.draft-list li input')!, 'Vite'))
    expect(text()).not.toContain('Title is required')
    await click(importButton('Save 2 entries'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(shown()).toEqual(['Vite', 'Drop me'])
  })

  it('stops on a failed save, says how many were saved, and keeps the rest to save again', async () => {
    await addProject('Demo')
    await paste('- Alpha\n- Beta\n- Gamma')
    const realPut = IDBObjectStore.prototype.put
    let writes = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      writes++
      if (writes === 2) throw new Error('disk full')
      return realPut.apply(this, args as Parameters<IDBObjectStore['put']>)
    })
    await click(importButton('Save 3 entries'))
    await until(() => text().includes('then this failed'))
    expect(text()).toContain('Saved 1 of 3 entries, then this failed: disk full.')
    expect(draftTitles()).toEqual(['Beta', 'Gamma'])
    expect(shown()).toEqual(['Alpha'])

    vi.restoreAllMocks()
    await click(importButton('Save 2 entries'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(shown()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('is not offered until a project is open', async () => {
    expect(
      [...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Import from chat')),
    ).toBe(false)
    await addProject('Demo')
    expect(button('Import from chat')).toBeTruthy()
  })

  it('Back keeps the pasted text, and a new preview replaces the edits made in review', async () => {
    await addProject('Demo')
    await paste('- Alpha\n- Beta')
    await act(async () => type(host.querySelector<HTMLInputElement>('.draft-list li input')!, 'Edited'))
    await click(importButton('Back'))
    expect(host.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!.value).toBe('- Alpha\n- Beta')
    await click(importButton('Preview'))
    expect(draftTitles()).toEqual(['Alpha', 'Beta'])
    expect(text()).toContain(
      'Back keeps your pasted text, but edits made here are replaced when you preview again.',
    )
  })

  it('does not open search or a new entry on / or n while the import dialog is open', async () => {
    await addProject('Demo')
    await click(button('Import from chat'))
    const press = (key: string) =>
      act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true })))
    await press('/')
    expect(document.activeElement).not.toBe(searchInput())
    await press('n')
    expect(host.querySelector('[aria-label="Entry"]')).toBeNull()
    expect(host.querySelector('[aria-label="Import from chat"]')).not.toBeNull()
  })

  it('ignores Esc and a click on the overlay while the drafts are saving, then closes after', async () => {
    await addProject('Demo')
    await paste('- Alpha\n- Beta')
    // The click starts the save, and its IndexedDB write is still pending when the next lines run.
    act(() => importButton('Save 2 entries').click())
    expect(host.querySelector<HTMLInputElement>('.draft-list li input')!.disabled).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      // A real press on the overlay, then the click, so the overlay path reaches the saving guard.
      const overlay = host.querySelector<HTMLElement>('.overlay')!
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      overlay.click()
    })
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(shown()).toEqual(['Alpha', 'Beta'])
  })

  it('keeps the dialog open after a press and click on the overlay during a save that then failed', async () => {
    await addProject('Demo')
    await paste('- Alpha')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('disk full')
    })
    act(() => importButton('Save 1 entry').click())
    // The press and the click land while the save is pending. The guard keeps the dialog open, and the click resets the press record.
    act(() => {
      const overlay = host.querySelector<HTMLElement>('.overlay')!
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      overlay.click()
    })
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await until(() => text().includes('then this failed'))
    // The save has stopped and the dialog is still open. A click with no press before it must not close it.
    await mouseEvent(host.querySelector('.overlay')!, 'click')
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('closes on Esc again once a failed save has stopped', async () => {
    await addProject('Demo')
    await paste('- Alpha')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('disk full')
    })
    await click(importButton('Save 1 entry'))
    await until(() => text().includes('then this failed'))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('says on the review step when only the first 200 drafts were read', async () => {
    await addProject('Demo')
    await paste(Array.from({ length: 5_000 }, (_, i) => `- item ${i}`).join('\n'))
    expect(draftTitles()).toHaveLength(200)
    expect(host.querySelector('[role="dialog"] [role="status"]')!.textContent).toBe(
      'Only the first 200 drafts were read; the rest of the paste was skipped.',
    )
  })

  it('says on the review step when the paste was cut at 200,000 characters, at a whole line', async () => {
    await addProject('Demo')
    const long = `- Long bullet\n${Array.from({ length: 12_000 }, (_, i) => `  continued line ${i} with some words`).join('\n')}`
    expect(long.length).toBeGreaterThan(200_000)
    await paste(long)
    expect(draftTitles()).toEqual(['Long bullet'])
    expect(host.querySelector('[role="dialog"] [role="status"]')!.textContent).toBe(
      'Only the first 200,000 characters were read, up to the last whole line; the rest of the paste was skipped.',
    )
  })
})

// A drag that selects text in the form and ends on the overlay fires a click on the overlay. Both dialogs
// must ignore that click, and still close on a plain overlay click.
describe.each([
  { name: 'entry', open: () => click(button('+ Entry')), field: 'input[placeholder="Title"]' },
  { name: 'import', open: () => click(button('Import from chat')), field: '[role="dialog"] textarea' },
])('$name dialog overlay', ({ open, field }) => {
  beforeEach(async () => {
    await addProject('Demo')
    await open()
  })

  it('stays open when the press starts in the form and the click lands on the overlay', async () => {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(field)!
    await act(async () => type(input, 'Keep this'))
    await mouseEvent(input, 'mousedown')
    await mouseEvent(host.querySelector('.overlay')!, 'click')
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(input.value).toBe('Keep this')
  })

  it('closes when the press starts on the overlay and the click is on the overlay', async () => {
    const overlay = host.querySelector('.overlay')!
    await mouseEvent(overlay, 'mousedown')
    await mouseEvent(overlay, 'click')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('does not close on a later overlay click after a press on the overlay that never got a click', async () => {
    const overlay = host.querySelector('.overlay')!
    await mouseEvent(overlay, 'mousedown')
    await mouseEvent(host.querySelector(field)!, 'mousedown')
    await mouseEvent(overlay, 'click')
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
