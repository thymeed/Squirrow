import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/ui/App'

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

async function addEntry(title: string, body = '') {
  await click(button('+ Entry'))
  await act(async () => {
    type(host.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, title)
    type(host.querySelector('textarea')!, body)
  })
  await click(button('Save'))
  await until(() => !host.querySelector('[role="dialog"]'))
}

const tick = (title: string) => {
  const label = [...host.querySelectorAll('.entries label')].find((l) => l.textContent?.includes(title))
  return click(label!.querySelector('input')!)
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
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

describe('app smoke', () => {
  it('shows the welcome guide on first load', () => {
    expect(text()).toContain('Welcome to Context Keeper')
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

  it('tells the user when the clipboard refuses the copy', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    await addProject('Demo')
    await addEntry('Use Postgres')
    await tick('Use Postgres')
    await click(button('Copy to clipboard'))
    await until(() => text().includes("Couldn't copy"))
    expect(text()).not.toContain('Copied ~')
  })

  it('shows a readable error when an import file is invalid', async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['nope'], 'bad.json')] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await until(() => text().includes('File is not valid JSON'))
  })
})
