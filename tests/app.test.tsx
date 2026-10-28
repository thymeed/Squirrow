import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIRST_ENTRY_SEEN_KEY, LAST_EXPORT_KEY } from '../src/core/backup'
import type { EntryKind } from '../src/core/types'
import { App } from '../src/ui/App'
import { useUpdateReady } from '../src/ui/useUpdateReady'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  await click(button('Save'))
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
    await click(button('Save'))
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
