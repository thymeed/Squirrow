/** Wraps text in a backtick fence longer than any backtick run inside it, so the text can't close it early. */
export function fenceBlock(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${text}\n${fence}`
}

/** Collapses line breaks so a title can't start a new line, such as an opening fence. */
export const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' ')

/**
 * The text after a bold list label: fenced on its own lines when the body contains a fence, otherwise
 * inline with later lines indented so they stay inside the list item instead of becoming new sections.
 */
export const afterLabel = (body: string): string =>
  /```|~~~/.test(body) ? `:\n${fenceBlock(body)}` : `: ${body.replace(/\n/g, '\n  ')}`
