import type { Graph } from '../engine/types'

/** Why a graph could not be loaded: a stable code (the UI translates `errors.<code>`) plus params. */
export type ParseError = { error: 'invalid-json' } | { error: 'unknown-format' } | { error: 'dangling-edge'; edgeId: string }
export type ParseErrorCode = ParseError['error']

export type ParseResult = { ok: true; graph: Graph } | ({ ok: false } & ParseError)

export const serializeGraph = (g: Graph): string => JSON.stringify({ version: 1, graph: g }, null, 2)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

const validNode = (n: unknown): boolean =>
  isObj(n) &&
  typeof n.id === 'string' &&
  typeof n.type === 'string' &&
  isObj(n.position) &&
  isNum(n.position.x) &&
  isNum(n.position.y) &&
  isObj(n.config)

const validEdge = (e: unknown): boolean => {
  if (!isObj(e) || typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') return false
  if (e.rule === undefined) return true
  return isObj(e.rule) && (e.rule.kind === 'pathPrefix' || e.rule.kind === 'eventType') && typeof e.rule.value === 'string'
}

/** Validate an already-parsed JSON value. */
export function validateGraphData(data: unknown): ParseResult {
  const bad: ParseResult = { ok: false, error: 'unknown-format' }
  if (!isObj(data) || data.version !== 1 || !isObj(data.graph)) return bad
  const { nodes, edges } = data.graph
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !nodes.every(validNode) || !edges.every(validEdge)) return bad
  const ids = new Set((nodes as { id: string }[]).map((n) => n.id))
  for (const e of edges as { id: string; source: string; target: string }[]) {
    if (!ids.has(e.source) || !ids.has(e.target)) return { ok: false, error: 'dangling-edge', edgeId: e.id }
  }
  return { ok: true, graph: data.graph as unknown as Graph }
}

export function parseGraph(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  return validateGraphData(data)
}
