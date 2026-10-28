import type { EntryKind } from './types'

/** One entry proposed from pasted chat text. Nothing is saved until the user keeps it. */
export interface Draft {
  kind: EntryKind
  title: string
  body: string
}

/**
 * Keyword rules that guess a kind from an entry's title and body. The first rule that matches wins, so
 * the order is the priority. Words match whole words only, so "undecided" is not "decided". An entry that
 * matches no rule is a fact, unless its section heading hints another kind (see SECTION_HINTS below).
 * These are heuristics. Tune the words here and expect some wrong guesses; the user reviews every draft.
 */
const KIND_RULES: readonly { kind: EntryKind; match: readonly RegExp[] }[] = [
  {
    kind: 'decision',
    match: [/\b(?:decided|decision|decisions|we chose|chose|agreed|going with|will use|settled on)\b/i],
  },
  {
    kind: 'preference',
    match: [
      /\b(?:prefer|prefers|preferred|preference|preferences|always|never|like to|style|styles|convention|conventions)\b/i,
    ],
  },
  {
    kind: 'file-note',
    match: [
      // A path such as ./x, src/foo.ts or a/b/c/d. "and/or" has no dot and only one slash, so it does not count.
      /(?:^|[\s`'"(])(?:\.{1,2}\/[\w./-]+|[\w-]+\/[\w.-]*\.\w+|[\w-]+(?:\/[\w.-]+){2,})/,
      // A file name with a common extension, such as main.tsx or README.md. This also matches Node.js.
      /(?<![\w./-])[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|kt|css|scss|html|yml|yaml|toml|sql|sh|env|txt|rb|php|swift|vue|svelte|c|h|cpp|cs)\b/i,
      /\b(?:files?|modules?|function in)\b/i,
    ],
  },
]

/** A section heading can hint the kind of the entries under it. The entry's own words still win over it. */
const SECTION_HINTS: readonly { kind: EntryKind; match: RegExp }[] = [
  { kind: 'decision', match: /\bdecision/i },
  { kind: 'preference', match: /\bpreference/i },
  { kind: 'file-note', match: /\bfile/i },
]

/** Input past this many characters (after line endings are normalized) is ignored, so a huge paste stays fast. */
export const MAX_INPUT_CHARS = 200_000
/** Drafts past this count are dropped. Later content is not read. */
export const MAX_DRAFTS = 200

const TITLE_MAX = 80
const LABEL_MAX = 60

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const BULLET = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?:\s+(.*))?$/
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/
/** "Title: rest", "**Title**: rest" and "**Note:** rest". Group 1 is the label, group 2 is what follows the colon. */
const LABEL = /^(?:\*\*|__)?([^:]+?)(?:\*\*|__)?:(.*)$/

type LineKind = 'none' | 'heading' | 'item' | 'continuation' | 'text' | 'fence'

const stripBold = (s: string): string => s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')

/** A line that is only list or rule characters, such as "-" or "* * *". */
const isEmptyLine = (s: string): boolean => /^[\s\-*_+.]*$/.test(s)

/** Cuts a long title at a sentence end or a word break, and marks the cut with an ellipsis. */
function cutTitle(text: string): string {
  if (text.length <= TITLE_MAX) return text
  const head = text.slice(0, TITLE_MAX)
  const sentence = [...head.matchAll(/[.!?](?=\s)/g)].pop()
  const at = sentence?.index ?? 0
  if (at >= 20) return `${head.slice(0, at).trimEnd()}…`
  const space = head.lastIndexOf(' ')
  if (space >= 20) return `${head.slice(0, space).replace(/[\s,;:-]+$/, '')}…`
  return `${head.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

/** A title and body from a first line. A long line is cut for the title, and the whole line stays in the body. */
function titled(head: string, rest: string): Pick<Draft, 'title' | 'body'> {
  const title = stripBold(head).trim()
  if (title.length <= TITLE_MAX) return { title, body: rest }
  return { title: cutTitle(title), body: [head, rest].filter(Boolean).join('\n') }
}

/** Joins a first line with following lines. The lines lose their shared indent, so nesting still shows. */
function joinLines(first: string, rest: string[]): string {
  const widths = rest.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length)
  const strip = widths.reduce((min, w) => Math.min(min, w), Number.POSITIVE_INFINITY)
  const shift = Number.isFinite(strip) ? strip : 0
  return [first, ...rest.map((l) => l.slice(shift))].join('\n').trim()
}

/** A bullet's title and body. "Title: rest" splits at the colon when the label is short. */
function splitItem(head: string, rest: string[]): Pick<Draft, 'title' | 'body'> {
  const label = LABEL.exec(head)
  if (label) {
    const name = stripBold(label[1] ?? '').trim()
    const after = label[2] ?? ''
    // "http://..." has a colon too, so a colon followed by "//" is not a label.
    if (name && name.length <= LABEL_MAX && !after.startsWith('//')) {
      return { title: name, body: joinLines(after.replace(/^(?:\*\*|__)/, '').trim(), rest) }
    }
  }
  return titled(head, joinLines('', rest))
}

function guessKind(text: string, sectionTitle: string): EntryKind {
  const rule = KIND_RULES.find((r) => r.match.some((re) => re.test(text)))
  if (rule) return rule.kind
  return SECTION_HINTS.find((h) => h.match.test(sectionTitle))?.kind ?? 'fact'
}

/** Removes up to `width` leading spaces or tabs, so a fence nested in a bullet keeps its code flush left. */
const unindent = (line: string, width: number): string => {
  const lead = line.length - line.trimStart().length
  return line.slice(Math.min(lead, width))
}

/**
 * Splits pasted chat text into draft entries. Heuristics only, and it never throws.
 *
 * - A markdown heading sets the section. A heading alone creates nothing. A heading followed only by
 *   plain paragraph text (no bullets or fences before the next heading) becomes one entry.
 * - Each top-level bullet (-, *, +, 1. or 1)) becomes one entry. Its first line is the title. Indented
 *   lines and nested bullets go to its body. "Title: rest" splits at the colon when the label is short.
 * - A fenced code block becomes a snippet, whose body is exactly the code. Its title is the text line
 *   just above it (if short), else the section heading, else "<language> snippet", else "Snippet".
 *   A fence indented inside a bullet is a snippet too, and it is not part of the bullet's body.
 *   An unclosed fence runs to the end of the input.
 * - Titles longer than 80 characters are cut at a sentence end or word break, with an ellipsis. The
 *   full first line goes to the body, so nothing is lost.
 * - Bullets with no text are skipped. Lines outside these shapes (plain text not under a heading, for
 *   example an intro sentence) are not imported.
 * - Input past MAX_INPUT_CHARS and drafts past MAX_DRAFTS are dropped without a message.
 */
export function parseChatSummary(text: string): Draft[] {
  if (typeof text !== 'string') return []
  const lines = text.replace(/\r\n?/g, '\n').slice(0, MAX_INPUT_CHARS).split('\n')
  const drafts: Draft[] = []
  const add = (d: Draft) => {
    if (d.title && drafts.length < MAX_DRAFTS) drafts.push(d)
  }

  let sectionTitle = ''
  let sectionHasBlock = false
  let paragraph: string[] = []
  let item: { head: string; lines: string[] } | null = null
  // Snippets from fences indented inside the open bullet. They come right after that bullet.
  let nested: Draft[] = []
  // The last non-blank line. Blank lines do not change it, and blankSince says whether one came after.
  let last: { kind: LineKind; text: string } = { kind: 'none', text: '' }
  let blankSince = false

  const flushItem = () => {
    if (!item) return
    const all = [item.head, ...item.lines]
    const first = all.findIndex((l) => !isEmptyLine(l))
    if (first !== -1) {
      const { title, body } = splitItem(all[first]!.trim(), all.slice(first + 1))
      add({ kind: guessKind(`${title}\n${body}`, sectionTitle), title, body })
    }
    nested.forEach(add)
    nested = []
    item = null
  }

  const flushSection = () => {
    const body = paragraph.join('\n').trim()
    paragraph = []
    if (sectionTitle && !sectionHasBlock && body) {
      const { title, body: full } = titled(sectionTitle, body)
      add({ kind: guessKind(`${title}\n${full}`, sectionTitle), title, body: full })
    }
  }

  for (let i = 0; i < lines.length && drafts.length < MAX_DRAFTS; i++) {
    const line = lines[i]!

    if (line.trim() === '') {
      blankSince = true
      if (item) item.lines.push('')
      continue
    }

    const fence = FENCE_OPEN.exec(line)
    if (fence && !(fence[2]!.startsWith('`') && fence[3]!.includes('`'))) {
      const indent = fence[1]!.length
      const marker = fence[2]!
      if (indent === 0) flushItem()
      sectionHasBlock = true
      const lang = fence[3]!.trim().split(/\s+/)[0] ?? ''
      const code: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const close = FENCE_CLOSE.exec(lines[j]!)
        if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) break
        code.push(unindent(lines[j]!, indent))
      }
      // The title is the nearest text line above the fence, if it is short. Blank lines are skipped.
      const above = last.kind === 'text' ? stripBold(last.text).trim() : ''
      const title =
        above && above.length <= TITLE_MAX ? above : sectionTitle || (lang ? `${lang} snippet` : 'Snippet')
      const body = code.join('\n').trimEnd()
      if (body.trim()) {
        const snippet: Draft = { kind: 'snippet', title, body }
        if (item) nested.push(snippet)
        else add(snippet)
      }
      last = { kind: 'fence', text: '' }
      blankSince = false
      i = j
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushItem()
      flushSection()
      sectionTitle = (heading[2] ?? '').replace(/[ \t]+#+$/, '').trim()
      sectionHasBlock = false
      last = { kind: 'heading', text: '' }
      blankSince = false
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet && item && bullet[1]!.length > 0) {
      item.lines.push(line)
      last = { kind: 'continuation', text: '' }
      blankSince = false
      continue
    }
    if (bullet) {
      flushItem()
      sectionHasBlock = true
      item = { head: (bullet[2] ?? '').trim(), lines: [] }
      last = { kind: 'item', text: '' }
      blankSince = false
      continue
    }

    // An indented line, or an unbroken line right after a bullet's text, continues the open bullet.
    const continues = last.kind === 'item' || last.kind === 'continuation'
    if (item && (/^\s/.test(line) || (continues && !blankSince))) {
      item.lines.push(line)
      last = { kind: 'continuation', text: '' }
      blankSince = false
      continue
    }
    flushItem()

    paragraph.push(line)
    last = { kind: 'text', text: line.trim() }
    blankSince = false
  }

  flushItem()
  flushSection()
  return drafts
}
