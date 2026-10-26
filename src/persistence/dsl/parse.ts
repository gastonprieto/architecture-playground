import { defaultRegistry } from '../../components'
import { defaultConfig, type ComponentDef } from '../../engine/registry'
import type { EdgeRule, Graph, GraphEdge, GraphNode, NodeId } from '../../engine/types'
import { COL, ROW } from '../grid'
import { suggest, type GraphDslError, type GraphDslErrorCode } from './errors'
import { parseFieldValue, unquote } from './values'

/**
 * Graph DSL (docs/graph-dsl-spec.md) → Graph, in three passes:
 *   1. `scan` turns the text into significant lines; `behavior:` blocks are cut out verbatim first.
 *   2. Lines are read as the header, declarations (+ their indented config) or edge lines.
 *   3. Ids are assigned (aliases, then slugs) and edge refs are resolved, so order does not matter.
 * Errors are collected (never thrown) and returned sorted by line.
 */

export type GraphDslResult = { ok: true; graph: Graph } | { ok: false; errors: GraphDslError[] }

/** Keyword → registry type: every registry type plus the short forms of spec §4. */
export const TYPE_KEYWORDS: Record<string, string> = {
  ...Object.fromEntries(defaultRegistry.list().map((def) => [def.type, def.type])),
  db: 'database',
  lb: 'load-balancer',
  proxy: 'reverse-proxy',
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'node'
}

export function parseGraphDsl(text: string): GraphDslResult {
  const { graph, errors } = parseDocument(text)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, graph }
}

/** Nodes without `at` sit at (0, 0); `placed` holds the ids that had one. */
export function parseDocument(text: string): { graph: Graph; placed: Set<NodeId>; errors: GraphDslError[] } {
  const errors: GraphDslError[] = []
  const error = (line: number, code: GraphDslErrorCode, params?: GraphDslError['params']) => {
    errors.push(params ? { line, code, params } : { line, code })
  }
  const { decls, edgeLines } = readStatements(scan(text, error), error)
  const { nodes, placed, aliases, names } = buildNodes(decls, error)
  const edges = buildEdges(edgeLines, aliases, names, error)
  errors.sort((a, b) => a.line - b.line)
  return { graph: { nodes, edges }, placed, errors }
}

type ErrorFn = (line: number, code: GraphDslErrorCode, params?: GraphDslError['params']) => void

/** Adds `suggestion` to `params` only when there is one. */
function withSuggestion(params: Record<string, string | number>, word: string, candidates: Iterable<string>) {
  const suggestion = suggest(word, candidates)
  return suggestion === undefined ? params : { ...params, suggestion }
}

// ---------------------------------------------------------------------------------------------
// Scan

interface Line {
  line: number
  indent: number
  /** Comment stripped and trimmed. */
  text: string
  /** The dedented block under a `key:` line, when it has one. */
  block?: string
}

function scan(text: string, error: ErrorFn): Line[] {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/)
  const lines: Line[] = []
  for (let i = 0; i < raw.length; i++) {
    const line = i + 1
    if (raw[i].trim() === '') continue
    const lead = /^[ \t]*/.exec(raw[i])![0]
    if (lead.includes('\t')) {
      error(line, 'tab')
      continue
    }
    const text = stripComment(raw[i]).trim()
    if (text === '') continue
    const entry: Line = { line, indent: lead.length, text }
    lines.push(entry)
    if (entry.indent === 0 || !/^[^\s:]+:$/.test(text)) continue
    // A `key:` line with nothing after it may open a block: blank lines and deeper ones, kept verbatim.
    const body: string[] = []
    let j = i + 1
    for (; j < raw.length; j++) {
      const spaces = /^ */.exec(raw[j])![0].length
      if (raw[j].trim() !== '' && spaces <= entry.indent) break
      body.push(raw[j].slice(Math.min(spaces, entry.indent + 2)))
    }
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    if (body.length > 0) entry.block = body.join('\n') + '\n'
    i = j - 1
  }
  return lines
}

/**
 * Drops a `#` comment: one at the first non-space position, or one with whitespace on both sides
 * (or at the end of the line). Never inside quotes, so `color: #d97706` and `"A # B"` stay.
 */
function stripComment(raw: string): string {
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quoted) {
      if (ch === '\\') i++
      else if (ch === '"') quoted = false
    } else if (ch === '"') {
      quoted = true
    } else if (ch === '#') {
      const first = raw.slice(0, i).trim() === ''
      const spaced = /\s/.test(raw[i - 1] ?? '') && (i + 1 === raw.length || /\s/.test(raw[i + 1]))
      if (first || spaced) return raw.slice(0, i)
    }
  }
  return raw
}

/** Splits on `sep` outside quotes and `[...]`. */
function splitOutside(text: string, sep: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '\\') i++
      else if (ch === '"') quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === '[') depth++
    else if (ch === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(text.slice(start, i))
      start = i + sep.length
      i += sep.length - 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

// ---------------------------------------------------------------------------------------------
// Statements

interface Decl {
  line: number
  def: ComponentDef
  names: string[]
  alias?: string
  position?: { x: number; y: number }
  config: Record<string, unknown>
}

interface Target {
  line: number
  ref: string
  rule?: EdgeRule
  weight?: number
  /** Broken target (its error is already reported): no edges are made with it. */
  bad?: boolean
  /** Resolved node id; null when the ref did not resolve. */
  id?: NodeId | null
}

const DECL = /^(.*?)(?:\s+as\s+([\p{L}\p{N}_-]+))?(?:\s+at\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?))?$/u

function readStatements(lines: Line[], error: ErrorFn): { decls: Decl[]; edgeLines: Target[][][] } {
  const decls: Decl[] = []
  const edgeLines: Target[][][] = []
  // The declaration indented lines belong to; 'skip' swallows the config of a broken declaration.
  let current: { decl: Decl; keys: Set<string> } | 'skip' | null = null
  lines.forEach((l, index) => {
    if (l.indent > 0) {
      if (l.indent !== 2 || current === null) error(l.line, 'bad-indent')
      else if (current !== 'skip') configLine(current.decl, current.keys, l, error)
      return
    }
    current = null
    const [word, ...restWords] = l.text.split(/\s+/)
    if (word === '@architecture' && index === 0) {
      const version = restWords.join(' ')
      if (version !== 'v1') error(l.line, 'unknown-version', { version })
    } else if (splitOutside(l.text, '-->').length > 1) {
      edgeLines.push(edgeLine(l, error))
    } else {
      const decl = declaration(l, error)
      if (decl) decls.push(decl)
      current = decl ? { decl, keys: new Set() } : 'skip'
    }
  })
  return { decls, edgeLines }
}

function declaration(l: Line, error: ErrorFn): Decl | null {
  const word = /^\S+/.exec(l.text)![0]
  const type = Object.hasOwn(TYPE_KEYWORDS, word) ? TYPE_KEYWORDS[word] : undefined
  if (!type) {
    error(l.line, 'unknown-type', withSuggestion({ word }, word, Object.keys(TYPE_KEYWORDS)))
    return null
  }
  const m = DECL.exec(l.text.slice(word.length).trim())!
  const names = splitOutside(m[1], ',').map((n) => unquote(n.trim()))
  if (names.some((n) => n === '')) {
    error(l.line, 'missing-name')
    return null
  }
  if (names.length > 1 && (m[2] !== undefined || m[3] !== undefined)) {
    error(l.line, 'multi-alias')
    return null
  }
  return {
    line: l.line,
    def: defaultRegistry.get(type)!,
    names,
    alias: m[2],
    position: m[3] === undefined ? undefined : { x: Number(m[3]) * COL, y: Number(m[4]) * ROW },
    config: {},
  }
}

function configLine(decl: Decl, keys: Set<string>, l: Line, error: ErrorFn): void {
  const colon = l.text.indexOf(':')
  if (colon < 0) {
    error(l.line, 'missing-colon')
    return
  }
  const key = l.text.slice(0, colon).trim()
  const value = l.text.slice(colon + 1).trim()
  const field = key !== 'name' && Object.hasOwn(decl.def.config, key) ? decl.def.config[key] : undefined
  if (!field) {
    const candidates = Object.keys(decl.def.config).filter((k) => k !== 'name')
    error(l.line, 'unknown-key', withSuggestion({ key, type: decl.def.type }, key, candidates))
    return
  }
  if (keys.has(key)) {
    error(l.line, 'duplicate-key', { key })
    return
  }
  keys.add(key)
  if (field.type === 'behavior') {
    if (value !== '') error(l.line, 'bad-value', { key, value })
    else decl.config[key] = l.block ?? ''
    return
  }
  if (l.block !== undefined) {
    error(l.line, 'bad-value', { key, value })
    return
  }
  const result = parseFieldValue(field, value)
  if (result.ok) decl.config[key] = result.value
  else if (result.code === 'out-of-range') error(l.line, 'out-of-range', { key, ...result.params })
  else error(l.line, 'bad-value', { key, value, ...result.params })
}

const TARGET = /^((?:"(?:[^"\\]|\\.)*"|[^"[])*)(?:\[(.*)\])?$/
const ATTR_TOKEN = /"(?:[^"\\]|\\.)*"|[^\s,"]+/g
const WEIGHT = /^\d+(\.\d+)?$/

/** `A, B --> C [/x] --> D` → groups of targets; attributes belong to the target they follow. */
function edgeLine(l: Line, error: ErrorFn): Target[][] {
  return splitOutside(l.text, '-->').map((group, g) =>
    splitOutside(group, ',').map((text) => {
      const m = TARGET.exec(text.trim())
      if (!m) {
        error(l.line, 'bad-attribute', { word: text.trim() })
        return { line: l.line, ref: '', bad: true }
      }
      const target: Target = { line: l.line, ref: unquote(m[1].trim()) }
      if (target.ref === '') {
        error(l.line, 'missing-name')
        return { ...target, bad: true }
      }
      if (m[2] === undefined) return target
      if (g === 0) {
        // The first group has no incoming edge to carry the attributes.
        error(l.line, 'bad-attribute', { word: `[${m[2]}]` })
        return { ...target, bad: true }
      }
      return attributes(target, m[2], error)
    }),
  )
}

function attributes(target: Target, text: string, error: ErrorFn): Target {
  const tokens = text.match(ATTR_TOKEN) ?? []
  const bad = (word: string) => {
    error(target.line, 'bad-attribute', { word })
    return { ...target, bad: true }
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    let rule: EdgeRule | undefined
    let weight: string | undefined
    if (token === 'path' || token === 'event' || token === 'weight') {
      const next = tokens[++i]
      if (next === undefined) return bad(token)
      if (token === 'weight') weight = next
      else rule = { kind: token === 'path' ? 'pathPrefix' : 'eventType', value: unquote(next) }
    } else if (token.startsWith('/')) rule = { kind: 'pathPrefix', value: token }
    else if (/^x[\d.]/.test(token)) weight = token.slice(1)
    else rule = { kind: 'eventType', value: unquote(token) }
    if (weight !== undefined) {
      if (!WEIGHT.test(weight) || target.weight !== undefined) return bad(weight)
      target.weight = Number(weight)
    }
    if (rule) {
      if (target.rule) {
        error(target.line, 'duplicate-rule')
        return { ...target, bad: true }
      }
      target.rule = rule
    }
  }
  return target
}

// ---------------------------------------------------------------------------------------------
// Ids and refs

function buildNodes(decls: Decl[], error: ErrorFn) {
  const taken = new Set<string>()
  const aliases = new Map<string, NodeId>()
  const ids = new Map<Decl, NodeId>()
  for (const decl of decls) {
    if (decl.alias === undefined) continue
    if (taken.has(decl.alias)) {
      error(decl.line, 'duplicate-alias', { alias: decl.alias })
      continue
    }
    taken.add(decl.alias)
    aliases.set(decl.alias, decl.alias)
    ids.set(decl, decl.alias)
  }
  const slugId = (name: string) => {
    const base = slugify(name)
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return id
  }

  const nodes: GraphNode[] = []
  const placed = new Set<NodeId>()
  const names = new Map<string, NodeId[]>()
  for (const decl of decls) {
    for (const name of decl.names) {
      const id = ids.get(decl) ?? slugId(name)
      const config = { ...defaultConfig(decl.def), name, ...structuredClone(decl.config) }
      nodes.push({ id, type: decl.def.type, position: decl.position ?? { x: 0, y: 0 }, config })
      if (decl.position) placed.add(id)
      names.set(name, [...(names.get(name) ?? []), id])
    }
  }
  return { nodes, placed, aliases, names }
}

function buildEdges(edgeLines: Target[][][], aliases: Map<string, NodeId>, names: Map<string, NodeId[]>, error: ErrorFn): GraphEdge[] {
  const resolve = (t: Target): NodeId | null => {
    if (t.bad) return null
    if (t.id !== undefined) return t.id
    const byName = names.get(t.ref) ?? []
    t.id = aliases.get(t.ref) ?? (byName.length === 1 ? byName[0] : null)
    if (t.id === null && byName.length > 1) error(t.line, 'ambiguous-ref', { name: t.ref })
    else if (t.id === null) error(t.line, 'unknown-ref', withSuggestion({ name: t.ref }, t.ref, [...names.keys(), ...aliases.keys()]))
    return t.id
  }

  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const groups of edgeLines) {
    groups.flat().forEach(resolve)
    for (let g = 0; g + 1 < groups.length; g++) {
      for (const s of groups[g]) {
        for (const t of groups[g + 1]) {
          const source = resolve(s)
          const target = resolve(t)
          if (source === null || target === null) continue
          const id = `${source}-${target}`
          if (seen.has(id)) {
            error(t.line, 'duplicate-edge', { source: s.ref, target: t.ref })
            continue
          }
          seen.add(id)
          edges.push({ id, source, target, ...(t.rule && { rule: t.rule }), ...(t.weight !== undefined && { weight: t.weight }) })
        }
      }
    }
  }
  return edges
}
