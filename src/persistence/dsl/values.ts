import type { Field } from '../../engine/registry'

export type ValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'bad-value' | 'out-of-range'; params?: Record<string, string | number> }

const BAD: ValueResult = { ok: false, code: 'bad-value' }
const NUMBER = /^-?\d+(\.\d+)?$/
const COLOR = /^#[0-9a-fA-F]{6}$/

/** `"…"` with `\"` and `\\` escapes; anything not wrapped in quotes is returned as is. */
export function unquote(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw
  return raw.slice(1, -1).replace(/\\(["\\])/g, '$1')
}

/** Wraps `s` in quotes (escaping `"` and `\`) when it matches `unsafe`. */
export function quoteIfNeeded(s: string, unsafe: RegExp): string {
  return unsafe.test(s) ? `"${s.replace(/["\\]/g, '\\$&')}"` : s
}

/** Splits on commas that are outside quotes; items are trimmed. */
function splitItems(raw: string): string[] {
  const items: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quoted && ch === '\\' && i + 1 < raw.length) {
      current += ch + raw[++i]
      continue
    }
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      items.push(current.trim())
      current = ''
    } else current += ch
  }
  items.push(current.trim())
  return items
}

function parseNumber(field: Extract<Field, { type: 'number' }>, raw: string): ValueResult {
  let text = raw.trim()
  if (field.unit && text.endsWith(field.unit)) text = text.slice(0, -field.unit.length).trim()
  if (!NUMBER.test(text)) return BAD
  const value = Number(text)
  if (value < field.min || value > field.max) {
    return { ok: false, code: 'out-of-range', params: { min: field.min, max: field.max } }
  }
  return { ok: true, value }
}

function parseMixItem(item: string): { value: string; weight: number } | undefined {
  // A quoted value is taken whole first, so an ` x<n>` inside the quotes is never read as a weight.
  const m = /^("(?:[^"\\]|\\.)*"|\S+)(?:\s+x(\S*))?$/.exec(item)
  if (!m) return undefined
  if (m[2] !== undefined && !NUMBER.test(m[2])) return undefined
  const weight = m[2] === undefined ? 1 : Number(m[2])
  if (weight < 0) return undefined
  return { value: unquote(m[1]), weight }
}

export function parseFieldValue(field: Field, raw: string): ValueResult {
  switch (field.type) {
    case 'number':
      return parseNumber(field, raw)
    case 'boolean': {
      const v = raw.trim()
      if (v === 'true' || v === 'on') return { ok: true, value: true }
      if (v === 'false' || v === 'off') return { ok: true, value: false }
      return BAD
    }
    case 'select': {
      const v = raw.trim()
      if (field.options.some((o) => o.value === v)) return { ok: true, value: v }
      return { ok: false, code: 'bad-value', params: { options: field.options.map((o) => o.value).join(', ') } }
    }
    case 'text':
      return { ok: true, value: unquote(raw.trim()) }
    case 'color':
      return COLOR.test(raw.trim()) ? { ok: true, value: raw.trim() } : BAD
    case 'list': {
      if (!raw.trim()) return { ok: true, value: [] }
      const items = splitItems(raw)
      return items.some((i) => !i) ? BAD : { ok: true, value: items.map(unquote) }
    }
    case 'mix': {
      if (!raw.trim()) return { ok: true, value: [] }
      const entries = splitItems(raw).map(parseMixItem)
      return entries.every((e) => e) ? { ok: true, value: entries } : BAD
    }
    case 'behavior':
      return BAD
  }
}

// A leading `#` is quoted so the graph parser never reads the value (or a lone `#` item) as a comment.
const ITEM_UNSAFE = /[,\s"]|^#/
const TEXT_UNSAFE = /^\s|\s$|^"|\s#|^#(\s|$)/

export function formatFieldValue(field: Field, value: unknown): string {
  switch (field.type) {
    case 'text':
      return quoteIfNeeded(String(value), TEXT_UNSAFE)
    case 'list':
      return (value as string[]).map((s) => quoteIfNeeded(s, ITEM_UNSAFE)).join(', ')
    case 'mix':
      return (value as { value: string; weight: number }[])
        .map((e) => quoteIfNeeded(e.value, ITEM_UNSAFE) + (e.weight === 1 ? '' : ` x${e.weight}`))
        .join(', ')
    default:
      return String(value)
  }
}
