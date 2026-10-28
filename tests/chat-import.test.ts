import { describe, expect, it } from 'vitest'
import {
  MAX_DRAFTS,
  MAX_INPUT_CHARS,
  parseChatSummary,
  parseChatSummaryDetailed,
  type Draft,
} from '../src/core/chatImport'

/** The drafts as plain [kind, title, body] rows, so a table reads at a glance. */
const rows = (drafts: Draft[]) => drafts.map((d) => [d.kind, d.title, d.body])

describe('parseChatSummary: sections and paragraphs', () => {
  it.each<[string, string, [string, string, string][]]>([
    ['headings only create nothing', '# Plan\n## Details\n### More', []],
    [
      'a heading with a plain paragraph becomes one fact',
      '## Setup\n\nRun the dev server.',
      [['fact', 'Setup', 'Run the dev server.']],
    ],
    [
      'a paragraph under a heading that also has bullets becomes a draft, in order',
      '## Stack\nHere is what we use.\n- Vite\n- Postgres',
      [
        ['fact', 'Here is what we use.', ''],
        ['fact', 'Vite', ''],
        ['fact', 'Postgres', ''],
      ],
    ],
    [
      'text before any heading becomes a draft',
      'Here is a summary of our chat.\n\n## Stack\n- Vite',
      [
        ['fact', 'Here is a summary of our chat.', ''],
        ['fact', 'Vite', ''],
      ],
    ],
    ['an empty heading creates nothing', '#\n\n- Vite', [['fact', 'Vite', '']]],
    [
      '"#tag" without a space is not a heading, so it is plain text',
      '#tag is text',
      [['fact', '#tag is text', '']],
    ],
  ])('%s', (_name, input, expected) => {
    expect(rows(parseChatSummary(input))).toEqual(expected)
  })
})

describe('parseChatSummary: bullets', () => {
  it.each<[string, string, string[]]>([
    [
      'dash, star, plus and numbered markers',
      '- one\n* two\n+ three\n1. four\n2) five',
      ['one', 'two', 'three', 'four', 'five'],
    ],
    ['bold text is stripped from the title', '- **Database** is Postgres', ['Database is Postgres']],
    ['a bullet of only a marker is skipped', '-\n*\n- - -\n- Real one', ['Real one']],
    [
      'a bullet with no text but a body under it takes its title from that body',
      '-\n  Use Postgres 16',
      ['Use Postgres 16'],
    ],
    [
      'a line that starts with a number and a dot, such as "1.5 million users", is not a numbered bullet',
      '1.5 million users\n- two',
      ['1.5 million users', 'two'],
    ],
  ])('%s', (_name, input, titles) => {
    expect(parseChatSummary(input).map((d) => d.title)).toEqual(titles)
  })

  it('keeps indented lines and nested bullets in the body', () => {
    const drafts = parseChatSummary(
      '- Stack summary\n  Vite for the build.\n  - sub one\n  - sub two\n- Next',
    )
    expect(rows(drafts)).toEqual([
      ['fact', 'Stack summary', 'Vite for the build.\n- sub one\n- sub two'],
      ['fact', 'Next', ''],
    ])
  })

  it('keeps a lazy line right after a bullet in its body, and a blank line ends the bullet', () => {
    const drafts = parseChatSummary('- Vite\nfast startup\n\nLoose words after a blank line')
    expect(rows(drafts)).toEqual([
      ['fact', 'Vite', 'fast startup'],
      ['fact', 'Loose words after a blank line', ''],
    ])
  })

  it.each<[string, string, [string, string]]>([
    ['"Title: rest" splits at the colon', '- Database: Postgres 16', ['Database', 'Postgres 16']],
    ['"**Title**: rest" splits after the bold', '- **Database**: Postgres 16', ['Database', 'Postgres 16']],
    ['"**Title:** rest" splits inside the bold', '- **Database:** Postgres 16', ['Database', 'Postgres 16']],
    ['a URL is not split', '- See http://example.com', ['See http://example.com', '']],
    ['"Note: x" with a short label still splits', '- Note: x', ['Note', 'x']],
  ])('%s', (_name, input, [title, body]) => {
    expect(parseChatSummary(input)).toEqual([expect.objectContaining({ title, body })])
  })

  it.each<[string, string]>([
    ['a time keeps its colon', '- We meet at 10:30 daily'],
    ['a ratio keeps its colon', '- Screens are 16:9 only'],
    ['a Windows path keeps its colon', '- Config is in C:\\foo\\bar.ts'],
    ['a drive path at the end keeps its colon', '- See D:\\proj\\x'],
    ['a URL with a colon in the path stays whole', '- Docs at https://example.com/a:b'],
    ['a time followed by a colon stays whole', '- 12:30: lunch'],
  ])('%s', (_name, input) => {
    expect(parseChatSummary(input).map((d) => [d.title, d.body])).toEqual([[input.slice(2), '']])
  })

  it('keeps the loose paragraph "Meeting at 10:30: bring notes" whole, because its colon is not a label', () => {
    expect(rows(parseChatSummary('Meeting at 10:30: bring notes'))).toEqual([
      ['fact', 'Meeting at 10:30: bring notes', ''],
    ])
  })

  it('does not split when the label is longer than 60 characters', () => {
    const label = 'This label is far too long to be a short name for an entry at all'
    const [draft] = parseChatSummary(`- ${label}: and the rest`)
    expect(draft).toEqual({ kind: 'fact', title: `${label}: and the rest`, body: '' })
  })

  it('cuts a long title at a sentence end and keeps the full line in the body', () => {
    const line =
      'Use Vite for the dev server. It starts fast and the build output is small enough to ship everywhere'
    const [draft] = parseChatSummary(`- ${line}`)
    expect(draft!.title).toBe('Use Vite for the dev server…')
    expect(draft!.body).toBe(line)
  })

  it('cuts a long title at a word break, with an ellipsis, and keeps the whole text in the body', () => {
    const line =
      'We decided to split the service into three deployable units because the billing path must stay independent of the reporting path'
    const [draft] = parseChatSummary(`- ${line}\n  Revisit in spring.`)
    expect(draft!.kind).toBe('decision')
    expect(draft!.title.endsWith('…')).toBe(true)
    expect(draft!.title.length).toBeLessThanOrEqual(81)
    expect(line.startsWith(draft!.title.slice(0, -1))).toBe(true)
    expect(draft!.body).toBe(`${line}\nRevisit in spring.`)
  })
})

describe('parseChatSummary: kind guessing', () => {
  it.each<[string, string, string]>([
    ['decided', '- We decided to use Vite', 'decision'],
    ['decision word', '- Decision: keep the monorepo', 'decision'],
    ['we chose', '- we chose SQLite', 'decision'],
    ['will use', '- Will use Postgres', 'decision'],
    ['undecided is not decided', '- Still undecided about caching', 'fact'],
    ['misdecided is not decided', '- We misdecided once', 'fact'],
    ['prefer', '- I prefer short answers', 'preference'],
    ['always', '- Always use semicolons', 'preference'],
    ['never', '- Never commit secrets', 'preference'],
    ['convention', '- Team convention is kebab-case', 'preference'],
    ['relative path', '- Config lives in ./config', 'file-note'],
    ['path with slashes', '- The entry point is src/main.tsx', 'file-note'],
    ['file name with extension', '- api.ts holds every network call', 'file-note'],
    ['the word file', '- The file list is sorted', 'file-note'],
    ['and/or is not a path', '- Choose and/or logic', 'fact'],
    ['plain fact', '- We use Postgres 16', 'fact'],
    ['decision beats preference', '- Decided to always lint', 'decision'],
    ['Node.js is a tech name, not a file', '- We use Node.js for the server', 'fact'],
    ['Next.js is a tech name, not a file', '- Next.js app router', 'fact'],
    ['ASP.NET is a tech name, not a file', '- ASP.NET Core', 'fact'],
    ['a path to a .js file is a file', '- Edit src/server.js', 'file-note'],
    ['a path to vue.js is a file', '- lib/vue.js holds the bundle', 'file-note'],
  ])('%s', (_name, input, kind) => {
    expect(parseChatSummary(input)[0]?.kind).toBe(kind)
  })

  it.each<[string, string, string]>([
    ['decisions section', '## Decisions\n- Use Vite', 'decision'],
    ['preferences section', '## Preferences\n- Plain answers', 'preference'],
    ['files section', '## Files\n- Holds the API client', 'file-note'],
    ['own words win over the section', '## Decisions\n- Prefer short answers', 'preference'],
    ['no hint means fact', '## Stack\n- Vite', 'fact'],
    ['"Profile" does not hint file-note', '## Profile\n- Plain answers', 'fact'],
  ])('section hint: %s', (_name, input, kind) => {
    expect(parseChatSummary(input)[0]?.kind).toBe(kind)
  })
})

describe('parseChatSummary: code fences', () => {
  it('uses the language as the title when nothing else is near', () => {
    expect(rows(parseChatSummary('```ts\nconst a = 1\n```'))).toEqual([
      ['snippet', 'ts snippet', 'const a = 1'],
    ])
  })

  it('uses a plain "Snippet" title when there is no language and no context', () => {
    expect(rows(parseChatSummary('```\nrun()\n```'))).toEqual([['snippet', 'Snippet', 'run()']])
  })

  it('uses the short text line just above the fence as the title', () => {
    expect(rows(parseChatSummary('Use this helper:\n\n```\nfn()\n```'))).toEqual([
      ['snippet', 'Use this helper:', 'fn()'],
    ])
  })

  it('uses the section heading when the line above is a heading', () => {
    expect(rows(parseChatSummary('## Helpers\n```js\nx()\n```'))).toEqual([['snippet', 'Helpers', 'x()']])
  })

  it('uses the section heading when the line above is too long, and that line becomes a paragraph', () => {
    const long = `${'word '.repeat(20)}end`
    expect(rows(parseChatSummary(`## Helpers\n${long}\n\`\`\`js\nx()\n\`\`\``))).toEqual([
      ['fact', `${'word '.repeat(15)}word…`, long],
      ['snippet', 'Helpers', 'x()'],
    ])
  })

  it('does not read a fence as paragraphs, and the text after it is one', () => {
    expect(
      rows(parseChatSummary('```js\nconst a = 1\n\nSome words in the code\n```\n\nAfter the code.')),
    ).toEqual([
      ['snippet', 'js snippet', 'const a = 1\n\nSome words in the code'],
      ['fact', 'After the code.', ''],
    ])
  })

  it('runs an unclosed fence to the end of the input', () => {
    expect(rows(parseChatSummary('## Run\n```sh\nnpm test\nnpm run build\n'))).toEqual([
      ['snippet', 'Run', 'npm test\nnpm run build'],
    ])
  })

  it('does not read headings or bullets inside a fence', () => {
    expect(rows(parseChatSummary('```md\n# not a heading\n- not a bullet\n```'))).toEqual([
      ['snippet', 'md snippet', '# not a heading\n- not a bullet'],
    ])
  })

  it('keeps a fence closed only by a matching marker, longer or equal', () => {
    expect(rows(parseChatSummary('````\n```\nstill code\n````'))).toEqual([
      ['snippet', 'Snippet', '```\nstill code'],
    ])
  })

  it('takes a fence nested in a bullet out of the bullet body', () => {
    const drafts = parseChatSummary(
      '- Set up the database\n  ```sql\n  CREATE TABLE t;\n  ```\n  Then run it once.\n- Next',
    )
    expect(rows(drafts)).toEqual([
      ['fact', 'Set up the database', 'Then run it once.'],
      ['snippet', 'sql snippet', 'CREATE TABLE t;'],
      ['fact', 'Next', ''],
    ])
  })

  it('does not import an empty fence', () => {
    expect(parseChatSummary('```js\n```')).toEqual([])
  })

  it('keeps the text line above an empty fence as a paragraph', () => {
    expect(rows(parseChatSummary('Keep this title line\n```\n```'))).toEqual([
      ['fact', 'Keep this title line', ''],
    ])
  })

  it('keeps the text line above a whitespace-only fence as a paragraph', () => {
    expect(rows(parseChatSummary('Keep me\n```\n   \n```'))).toEqual([['fact', 'Keep me', '']])
  })

  it('takes the line above a non-empty fence as its title, and does not repeat it', () => {
    expect(rows(parseChatSummary('Keep me\n```\nx\n```'))).toEqual([['snippet', 'Keep me', 'x']])
  })
})

describe('parseChatSummary: loose paragraphs', () => {
  it('imports an intro sentence before any heading', () => {
    expect(rows(parseChatSummary('Here is the summary of our chat.\n\n## Stack\n- Vite'))).toEqual([
      ['fact', 'Here is the summary of our chat.', ''],
      ['fact', 'Vite', ''],
    ])
  })

  it('imports a loose paragraph between the bullets of one section, in order', () => {
    expect(
      rows(parseChatSummary('## Stack\n- Vite\n\nWe also run the tests nightly.\n\n- Postgres')),
    ).toEqual([
      ['fact', 'Vite', ''],
      ['fact', 'We also run the tests nightly.', ''],
      ['fact', 'Postgres', ''],
    ])
  })

  it('makes two paragraphs separated by a blank line two drafts', () => {
    expect(rows(parseChatSummary('First thing to know.\n\nSecond thing to know.'))).toEqual([
      ['fact', 'First thing to know.', ''],
      ['fact', 'Second thing to know.', ''],
    ])
  })

  it('treats a line of only spaces, tabs or no-break spaces as blank', () => {
    const drafts = parseChatSummary('First thing.\n  \t \nSecond thing.\n \nThird thing.')
    expect(drafts.map((d) => d.title)).toEqual(['First thing.', 'Second thing.', 'Third thing.'])
  })

  it('guesses the kind of a loose paragraph from its words', () => {
    expect(rows(parseChatSummary('We decided to ship on Friday.'))).toEqual([
      ['decision', 'We decided to ship on Friday.', ''],
    ])
  })

  it('gives a heading over one plain paragraph exactly one entry', () => {
    expect(rows(parseChatSummary('## Setup\nRun the dev server.\nThen open the page.'))).toEqual([
      ['fact', 'Setup', 'Run the dev server.\nThen open the page.'],
    ])
  })

  it('never reads the lines of a fence as paragraphs', () => {
    expect(rows(parseChatSummary('## Run\n```sh\nnpm test\n\nNot a paragraph\n```'))).toEqual([
      ['snippet', 'Run', 'npm test\n\nNot a paragraph'],
    ])
  })

  it('does not turn a rule line such as "---" into a draft', () => {
    expect(rows(parseChatSummary('Intro.\n---\nMore.'))).toEqual([
      ['fact', 'Intro.', ''],
      ['fact', 'More.', ''],
    ])
  })

  it('keeps indented lines under a bullet in that bullet, not as paragraphs', () => {
    expect(
      rows(parseChatSummary('- Vite\n  Fast startup.\n\n  Still the same bullet.\n\nLoose end.')),
    ).toEqual([
      ['fact', 'Vite', 'Fast startup.\n\nStill the same bullet.'],
      ['fact', 'Loose end.', ''],
    ])
  })

  it('splits a loose paragraph at a short label, like a bullet', () => {
    expect(rows(parseChatSummary('Note: the build runs on CI.'))).toEqual([
      ['fact', 'Note', 'the build runs on CI.'],
    ])
  })
})

describe('parseChatSummary: whitespace, line endings and limits', () => {
  it.each<[string, string]>([
    ['empty input', ''],
    ['spaces only', '   '],
    ['tabs and newlines only', '\t\n \n\n'],
  ])('gives [] for %s', (_name, input) => {
    expect(parseChatSummary(input)).toEqual([])
  })

  it('reads CRLF and bare CR line endings the same as LF', () => {
    const lf = '## Stack\n- Vite\n- Postgres: version 16\n\n```ts\nconst a = 1\n```\n'
    const expected = rows(parseChatSummary(lf))
    expect(rows(parseChatSummary(lf.replace(/\n/g, '\r\n')))).toEqual(expected)
    expect(rows(parseChatSummary(lf.replace(/\n/g, '\r')))).toEqual(expected)
    expect(expected).toEqual([
      ['fact', 'Vite', ''],
      ['fact', 'Postgres', 'version 16'],
      ['snippet', 'Stack', 'const a = 1'],
    ])
  })

  it('does not throw on a very large input and stops at the draft cap', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => `- item ${i}`).join('\n')
    expect(big.length).toBeGreaterThan(MAX_INPUT_CHARS)
    const drafts = parseChatSummary(big)
    expect(drafts).toHaveLength(MAX_DRAFTS)
    expect(drafts[0]!.title).toBe('item 0')
    expect(drafts.at(-1)!.title).toBe(`item ${MAX_DRAFTS - 1}`)
  })

  it('ignores input past the character cap', () => {
    const input = `- early\n${' '.repeat(MAX_INPUT_CHARS)}\n- late`
    expect(rows(parseChatSummary(input))).toEqual([['fact', 'early', '']])
  })

  it('does not throw on one very long line of text', () => {
    expect(() => parseChatSummary(`- ${'a: '.repeat(100_000)}`)).not.toThrow()
    expect(() => parseChatSummary(`## ${'word '.repeat(60_000)}\n- x`)).not.toThrow()
  })

  it('does not throw on a bullet body with a very large number of lines', () => {
    const input = `- head\n${Array.from({ length: 100_000 }, (_, i) => `  line ${i}`).join('\n')}`
    expect(parseChatSummary(input)).toHaveLength(1)
  })

  it('returns [] for input that is not a string', () => {
    expect(parseChatSummary(undefined as unknown as string)).toEqual([])
  })
})

describe('parseChatSummary: a realistic chat summary', () => {
  it('splits every section into the right kind of draft', () => {
    const summary = [
      'Here is a summary of our chat about the Squirrow build.',
      '',
      '## Stack',
      '- We use Vite and React 19 with TypeScript.',
      '- **Storage**: IndexedDB through the idb wrapper.',
      '',
      '## Decisions',
      '- We decided to keep the app free of any backend.',
      '- Chose Vitest over Jest because it shares the Vite config.',
      '',
      '## Preferences',
      '- Always give short answers with no filler.',
      '',
      '## Files',
      '- src/core/search.ts ranks entries.',
      '',
      '## Commands',
      '```bash',
      'npm test',
      'npm run build',
      '```',
      '',
      'Next step: write the import dialog.',
      '',
      '## Open questions',
      'Should imports merge or replace?',
    ].join('\n')

    expect(rows(parseChatSummary(summary))).toEqual([
      ['fact', 'Here is a summary of our chat about the Squirrow build.', ''],
      ['fact', 'We use Vite and React 19 with TypeScript.', ''],
      ['fact', 'Storage', 'IndexedDB through the idb wrapper.'],
      ['decision', 'We decided to keep the app free of any backend.', ''],
      ['decision', 'Chose Vitest over Jest because it shares the Vite config.', ''],
      ['preference', 'Always give short answers with no filler.', ''],
      ['file-note', 'src/core/search.ts ranks entries.', ''],
      ['snippet', 'Commands', 'npm test\nnpm run build'],
      ['fact', 'Next step', 'write the import dialog.'],
      ['fact', 'Open questions', 'Should imports merge or replace?'],
    ])
  })

  it('imports loose paragraphs, tech names and paths from a chat summary end to end', () => {
    const summary = [
      'Here is a summary of our chat about the import feature.',
      '',
      '## Stack',
      '- We use Node.js for the server.',
      '- **Storage**: IndexedDB through the idb wrapper.',
      '',
      'The UI is plain React, with no router.',
      '',
      '## Decisions',
      'We decided to keep the app free of any backend.',
      '- Chose Vitest over Jest.',
      '',
      '## Preferences',
      '- Always give short answers.',
      '',
      '## Files',
      'Edit src/server.js and lib/vue.js.',
      '',
      '## Commands',
      '```bash',
      'npm test',
      '```',
      '',
      'Next step: write the import dialog.',
      '',
      '## Open questions',
      'Should imports merge or replace?',
    ].join('\n')

    expect(rows(parseChatSummary(summary))).toEqual([
      ['fact', 'Here is a summary of our chat about the import feature.', ''],
      ['fact', 'We use Node.js for the server.', ''],
      ['fact', 'Storage', 'IndexedDB through the idb wrapper.'],
      ['fact', 'The UI is plain React, with no router.', ''],
      ['decision', 'We decided to keep the app free of any backend.', ''],
      ['decision', 'Chose Vitest over Jest.', ''],
      ['preference', 'Always give short answers.', ''],
      ['file-note', 'Files', 'Edit src/server.js and lib/vue.js.'],
      ['snippet', 'Commands', 'npm test'],
      ['fact', 'Next step', 'write the import dialog.'],
      ['fact', 'Open questions', 'Should imports merge or replace?'],
    ])
  })
})

describe('parseChatSummaryDetailed: caps', () => {
  it('reports nothing cut for a normal paste', () => {
    expect(parseChatSummaryDetailed('- Vite\n- Postgres').truncated).toBeNull()
  })

  it('reports nothing cut at exactly the draft cap', () => {
    const input = Array.from({ length: MAX_DRAFTS }, (_, i) => `- item ${i}`).join('\n')
    const result = parseChatSummaryDetailed(input)
    expect(result.drafts).toHaveLength(MAX_DRAFTS)
    expect(result.truncated).toBeNull()
  })

  it('reports drafts cut past the draft cap', () => {
    const input = Array.from({ length: MAX_DRAFTS + 1 }, (_, i) => `- item ${i}`).join('\n')
    const result = parseChatSummaryDetailed(input)
    expect(result.drafts).toHaveLength(MAX_DRAFTS)
    expect(result.truncated).toBe('drafts')
  })

  it('reports characters cut past the character cap', () => {
    const input = `- head\n${Array.from({ length: 30_000 }, (_, i) => `  line ${i}`).join('\n')}`
    expect(input.length).toBeGreaterThan(MAX_INPUT_CHARS)
    expect(parseChatSummaryDetailed(input).truncated).toBe('chars')
  })

  it('drops the line the character cap cuts in half, so no partial line becomes text', () => {
    const lines = Array.from({ length: 30_000 }, (_, i) => `  line ${i}`)
    const input = `- head\n${lines.join('\n')}`
    const { drafts } = parseChatSummaryDetailed(input)
    // The whole lines that end before the cap, after the head line. Their indent is removed in the body.
    const cutAt = input.lastIndexOf('\n', MAX_INPUT_CHARS)
    const kept = input.slice(0, cutAt).split('\n').slice(1)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.body).toBe(kept.map((l) => l.slice(2)).join('\n'))
    expect(input.slice(cutAt + 1).startsWith(lines[kept.length]!)).toBe(true)
  })

  it('keeps the last whole line when the cap falls right after its line break', () => {
    const head = '- kept\n'
    const run = 'x'.repeat(MAX_INPUT_CHARS - head.length - 1)
    const input = `${head}${run}\n- late`
    const { drafts, truncated } = parseChatSummaryDetailed(input)
    expect(truncated).toBe('chars')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.body).toBe(run)
  })

  it('reports drafts first when both caps are hit', () => {
    const input = Array.from({ length: 20_000 }, (_, i) => `- item ${i}`).join('\n')
    expect(input.length).toBeGreaterThan(MAX_INPUT_CHARS)
    expect(parseChatSummaryDetailed(input).truncated).toBe('drafts')
  })

  it('keeps the first drafts and the drafts flag when a bullet and an open fence follow the cap', () => {
    const bullets = Array.from({ length: MAX_DRAFTS + 3 }, (_, i) => `- item ${i}`)
    const { drafts, truncated } = parseChatSummaryDetailed([...bullets, '```ts', 'const a = 1'].join('\n'))
    expect(drafts.map((d) => d.title)).toEqual(Array.from({ length: MAX_DRAFTS }, (_, i) => `item ${i}`))
    expect(truncated).toBe('drafts')
  })

  it('gives many short lines past the cap their drafts and the chars flag, as before', () => {
    // 200 entries of about 1,300 characters each. Only the first 200,000 characters are read, so some drafts remain.
    const entry = (i: number) =>
      [`- item ${i}`, ...Array.from({ length: 130 }, (_, k) => `  note ${k}`)].join('\n')
    const input = Array.from({ length: 200 }, (_, i) => entry(i)).join('\n')
    expect(input.length).toBeGreaterThan(250_000)
    const { drafts, truncated } = parseChatSummaryDetailed(input)
    expect(truncated).toBe('chars')
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.length).toBeLessThan(MAX_DRAFTS)
    expect(drafts.at(-1)!.title).toBe(`item ${drafts.length - 1}`)
  })

  it('refuses a single line longer than the cap, with no drafts and the line flag', () => {
    expect(parseChatSummaryDetailed('x'.repeat(250_000))).toEqual({ drafts: [], truncated: 'line' })
    expect(parseChatSummaryDetailed('- ' + 'word '.repeat(50_000))).toEqual({ drafts: [], truncated: 'line' })
    expect(parseChatSummaryDetailed('\n' + 'x'.repeat(250_000))).toEqual({ drafts: [], truncated: 'line' })
    expect(parseChatSummaryDetailed('   \n' + 'x'.repeat(250_000))).toEqual({ drafts: [], truncated: 'line' })
  })

  it('does not use the line flag for blank input past the cap, which gives no drafts and the chars flag', () => {
    expect(parseChatSummaryDetailed(' '.repeat(250_000))).toEqual({ drafts: [], truncated: 'chars' })
    expect(parseChatSummaryDetailed('\n'.repeat(250_000))).toEqual({ drafts: [], truncated: 'chars' })
  })

  it('does not refuse a paste past the cap when a whole line fits before it', () => {
    const { drafts, truncated } = parseChatSummaryDetailed(`- kept\n${'x'.repeat(250_000)}`)
    expect(truncated).toBe('chars')
    expect(drafts).toEqual([{ kind: 'fact', title: 'kept', body: '' }])
  })

  it('parseChatSummary returns the same drafts as the detailed parser', () => {
    const input = Array.from({ length: MAX_DRAFTS + 5 }, (_, i) => `- item ${i}`).join('\n')
    expect(parseChatSummary(input)).toEqual(parseChatSummaryDetailed(input).drafts)
  })

  it('returns no drafts and no cut for input that is not a string', () => {
    expect(parseChatSummaryDetailed(undefined as unknown as string)).toEqual({ drafts: [], truncated: null })
  })
})
