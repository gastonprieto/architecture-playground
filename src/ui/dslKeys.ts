/*
 * Editing keys of the behavior editor, as pure functions on (text, selection). Indentation is the
 * language (blocks are 2 spaces deeper than their header), so Tab and Enter work on indentation.
 */

const INDENT = '  '

/** Replace [from, to) with `insert`, then select [selStart, selEnd) in the new text. */
export interface TextEdit {
  from: number
  to: number
  insert: string
  selStart: number
  selEnd: number
}

export const applyEdit = (text: string, e: TextEdit): string => text.slice(0, e.from) + e.insert + text.slice(e.to)

const lineStart = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1
const lineEnd = (text: string, i: number) => {
  const n = text.indexOf('\n', i)
  return n === -1 ? text.length : n
}

/** The code part of a line: everything before a `#` that is outside quotes. */
function stripComment(line: string): string {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === '#' && !quoted) return line.slice(0, i)
  }
  return line
}

/** The whole lines touched by the selection (a selection ending at a line start leaves that line out). */
function selectedLines(text: string, selStart: number, selEnd: number) {
  const from = lineStart(text, selStart)
  const last = selEnd > selStart && text[selEnd - 1] === '\n' ? selEnd - 1 : selEnd
  const to = lineEnd(text, last)
  return { from, to, lines: text.slice(from, to).split('\n') }
}

function indentLines(text: string, selStart: number, selEnd: number): TextEdit {
  const { from, to, lines } = selectedLines(text, selStart, selEnd)
  const added = lines.map((l) => (l === '' ? 0 : INDENT.length))
  return {
    from,
    to,
    insert: lines.map((l, i) => (added[i] ? INDENT + l : l)).join('\n'),
    selStart: selStart + added[0],
    selEnd: selEnd + added.reduce((a, b) => a + b, 0),
  }
}

function dedentLines(text: string, selStart: number, selEnd: number): TextEdit | null {
  const { from, to, lines } = selectedLines(text, selStart, selEnd)
  const removed = lines.map((l) => Math.min(INDENT.length, /^ */.exec(l)![0].length))
  const total = removed.reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const lastStart = lineStart(text, Math.min(selEnd, to))
  const beforeLast = total - removed[removed.length - 1]
  return {
    from,
    to,
    insert: lines.map((l, i) => l.slice(removed[i])).join('\n'),
    selStart: selStart - Math.min(removed[0], selStart - from),
    selEnd: selEnd - beforeLast - Math.min(removed[removed.length - 1], selEnd - lastStart),
  }
}

function newline(text: string, selStart: number, selEnd: number): TextEdit {
  const before = text.slice(lineStart(text, selStart), selStart)
  let indent = /^ */.exec(before)![0]
  if (stripComment(before).trimEnd().endsWith(':')) indent += INDENT
  const insert = `\n${indent}`
  const caret = selStart + insert.length
  return { from: selStart, to: selEnd, insert, selStart: caret, selEnd: caret }
}

/**
 * The edit for Tab (two spaces, or indent every selected line), Shift+Tab (dedent the current or
 * selected lines) and Enter (new line keeping the indentation, two more after a line ending in `:`).
 * Null when the key changes nothing (Shift+Tab on unindented lines).
 */
export function dslKeyEdit(text: string, selStart: number, selEnd: number, key: 'Tab' | 'Enter', shift: boolean): TextEdit | null {
  if (key === 'Enter') return newline(text, selStart, selEnd)
  if (shift) return dedentLines(text, selStart, selEnd)
  if (text.slice(selStart, selEnd).includes('\n')) return indentLines(text, selStart, selEnd)
  const caret = selStart + INDENT.length
  return { from: selStart, to: selEnd, insert: INDENT, selStart: caret, selEnd: caret }
}
