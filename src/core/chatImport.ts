import type { EntryKind } from './types'

/** One entry proposed from pasted chat text. Nothing is saved until the user keeps it. */
export interface Draft {
  kind: EntryKind
  title: string
  body: string
}

/**
 * Well-known names with a dot that are not file names, such as "Node.js". The file-note path and extension
 * rules skip them, so "We use Node.js" stays a fact. Real paths such as "lib/vue.js" still count. Matching
 * ignores case and needs whole words.
 */
const DOTTED_TECH_NAMES: readonly string[] = [
  'Node.js',
  'Vue.js',
  'Next.js',
  'Nuxt.js',
  'React.js',
  'Angular.js',
  'Ember.js',
  'Backbone.js',
  'Alpine.js',
  'Solid.js',
  'Gatsby.js',
  'Express.js',
  'Nest.js',
  'Three.js',
  'D3.js',
  'Chart.js',
  'p5.js',
  'Socket.io',
  'ASP.NET',
  '.NET',
  'VB.NET',
]

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A tech name as a whole word. A dot, slash or dash next to it makes it part of a path, so it does not match. */
const TECH_NAME = new RegExp(
  `(?<![\\w./\\\\-])(?:${DOTTED_TECH_NAMES.map(escapeRegExp).join('|')})(?![\\w/\\\\-])`,
  'gi',
)

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
      // A file name with a common extension, such as main.tsx or README.md.
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

/**
 * Input past this many characters (after line endings are normalized) is cut at the last line break before
 * the cap, so a huge paste stays fast and no line is read half way.
 */
export const MAX_INPUT_CHARS = 200_000
/** Drafts past this count are dropped. */
export const MAX_DRAFTS = 200

/**
 * Which cap cut the paste short, or null when neither did. 'line' means the paste has text, but no whole line
 * fits within MAX_INPUT_CHARS, so nothing is read and the paste is refused.
 */
export type Truncation = 'drafts' | 'chars' | 'line' | null

export interface ChatSummary {
  drafts: Draft[]
  truncated: Truncation
}

const TITLE_MAX = 80
const LABEL_MAX = 60

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const BULLET = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?:\s+(.*))?$/
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/
/**
 * "Title: rest", "**Title**: rest" and "**Note:** rest". The colon must be followed by a space or the end of the
 * line (after an optional closing bold), so "10:30", "C:\x" and "http://" stay whole. Group 1 is the label,
 * group 2 is what follows the colon.
 */
const LABEL = /^(?:\*\*|__)?([^:]+?)(?:\*\*|__)?:(?:(?:\*\*|__)?(?=\s|$))(.*)$/

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

/** A bullet's or a paragraph's title and body. "Title: rest" splits at a colon followed by a space when the label is short. */
function splitItem(head: string, rest: string[]): Pick<Draft, 'title' | 'body'> {
  const label = LABEL.exec(head)
  if (label) {
    const name = stripBold(label[1] ?? '').trim()
    const after = label[2] ?? ''
    if (name && name.length <= LABEL_MAX) {
      return { title: name, body: joinLines(after.trim(), rest) }
    }
  }
  return titled(head, joinLines('', rest))
}

function guessKind(text: string, sectionTitle: string): EntryKind {
  // The file-note rules read the text with tech names blanked out. The other rules read it as it is.
  const noNames = text.replace(TECH_NAME, ' ')
  const rule = KIND_RULES.find((r) => r.match.some((re) => re.test(r.kind === 'file-note' ? noNames : text)))
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
 * - A markdown heading sets the section. A heading alone creates nothing. A heading followed only by one
 *   plain paragraph (no bullets or fences in that section) becomes one entry, titled by the heading.
 * - A loose paragraph is a run of lines that are not blank, headings, bullets or fences, such as an intro
 *   sentence. A blank line, heading, bullet, fence or rule line such as "---" ends it. Each paragraph
 *   becomes one entry, in input order. Its first line is the title and the rest is the body, split and
 *   guessed the same way as a bullet. Indented lines under a bullet stay in that bullet's body.
 * - Each top-level bullet (-, *, +, 1. or 1)) becomes one entry. Its first line is the title. Indented
 *   lines and nested bullets go to its body. "Title: rest" splits at a colon followed by a space when the label is short.
 * - A fenced code block becomes a snippet, whose body is exactly the code. Its title is the text line
 *   just above it (if short), else the section heading, else "<language> snippet", else "Snippet".
 *   That line is used as the title, so it is not also a paragraph. A fence indented inside a bullet is a
 *   snippet too, and it is not part of the bullet's body. An unclosed fence runs to the end of the input.
 * - Titles longer than 80 characters are cut at a sentence end or word break, with an ellipsis. The
 *   full first line goes to the body, so nothing is lost.
 * - Bullets with no text are skipped. Input past MAX_INPUT_CHARS is cut at the last line break before the
 *   cap, and drafts past MAX_DRAFTS are dropped. Either one sets `truncated`, so the caller can say so.
 * - If no whole line fits in the cap, the paste has text, and it is past the cap, nothing is read and
 *   `truncated` is 'line'. Blank input past the cap is not this case. It gives no drafts and 'chars'.
 */
export function parseChatSummaryDetailed(text: string): ChatSummary {
  if (typeof text !== 'string') return { drafts: [], truncated: null }
  const normal = text.replace(/\r\n?/g, '\n')
  const charsCut = normal.length > MAX_INPUT_CHARS
  // The last line break at or before the cap. Lines before it are whole, so the line cut by the cap is dropped.
  const kept = charsCut ? normal.slice(0, Math.max(normal.lastIndexOf('\n', MAX_INPUT_CHARS), 0)) : normal
  if (charsCut && kept.trim() === '' && normal.trim() !== '') return { drafts: [], truncated: 'line' }
  const lines = kept.split('\n')
  const drafts: Draft[] = []
  let overflow = false
  const add = (d: Draft) => {
    if (!d.title) return
    if (drafts.length < MAX_DRAFTS) drafts.push(d)
    else overflow = true
  }

  let sectionTitle = ''
  // Whether the open section has a bullet or a fence. Without one, a lone paragraph is the heading's entry.
  let sectionHasBlock = false
  // The paragraph being read, and the closed paragraphs of the section that no bullet or fence has settled yet.
  let paragraph: string[] = []
  let loose: string[][] = []
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

  const closeParagraph = () => {
    if (paragraph.length > 0) loose.push(paragraph)
    paragraph = []
  }

  const flushLoose = () => {
    for (const lines of loose) {
      const { title, body } = splitItem(lines[0]!.trim(), lines.slice(1))
      add({ kind: guessKind(`${title}\n${body}`, sectionTitle), title, body })
    }
    loose = []
  }

  // Called when a bullet or fence starts. The paragraphs before it in this section are entries of their own.
  const startBlock = () => {
    closeParagraph()
    flushLoose()
    sectionHasBlock = true
  }

  const flushSection = () => {
    closeParagraph()
    if (sectionTitle && !sectionHasBlock && loose.length === 1) {
      const { title, body } = titled(sectionTitle, loose[0]!.join('\n').trim())
      add({ kind: guessKind(`${title}\n${body}`, sectionTitle), title, body })
      loose = []
    } else {
      flushLoose()
    }
  }

  for (let i = 0; i < lines.length; i++) {
    // Once a draft past the cap is found, the drafts are final. Reading on would only be wasted work.
    if (overflow) break
    const line = lines[i]!

    if (line.trim() === '') {
      closeParagraph()
      blankSince = true
      if (item) item.lines.push('')
      continue
    }

    const fence = FENCE_OPEN.exec(line)
    if (fence && !(fence[2]!.startsWith('`') && fence[3]!.includes('`'))) {
      const indent = fence[1]!.length
      const marker = fence[2]!
      if (indent === 0) flushItem()
      const lang = fence[3]!.trim().split(/\s+/)[0] ?? ''
      const code: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const close = FENCE_CLOSE.exec(lines[j]!)
        if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) break
        code.push(unindent(lines[j]!, indent))
      }
      const body = code.join('\n').trimEnd()
      // The title is the nearest text line above the fence, if it is short. Blank lines are skipped.
      const above = last.kind === 'text' ? stripBold(last.text).trim() : ''
      const useAbove = above !== '' && above.length <= TITLE_MAX
      closeParagraph()
      const owner = loose[loose.length - 1]
      // Only a fence that adds a snippet takes that line. An empty fence leaves the line as a paragraph.
      if (useAbove && owner && body.trim()) {
        // That line is the title, so it does not also become a paragraph. It is the last line of the last paragraph.
        owner.pop()
        if (owner.length === 0) loose.pop()
      }
      const title = useAbove ? above : sectionTitle || (lang ? `${lang} snippet` : 'Snippet')
      startBlock()
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
      startBlock()
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

    // A rule line such as "---" is not text. It ends the paragraph, like a blank line.
    if (isEmptyLine(line)) {
      closeParagraph()
      last = { kind: 'none', text: '' }
      blankSince = true
      continue
    }

    paragraph.push(line)
    last = { kind: 'text', text: line.trim() }
    blankSince = false
  }

  flushItem()
  flushSection()
  const truncated: Truncation = overflow ? 'drafts' : charsCut ? 'chars' : null
  return { drafts, truncated }
}

/** The drafts only. See parseChatSummaryDetailed for the caps. */
export function parseChatSummary(text: string): Draft[] {
  return parseChatSummaryDetailed(text).drafts
}
