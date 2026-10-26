import type { Graph } from '../engine/types'
import { parseGraphDsl, type GraphDslError } from './dsl'
import { parseGraph, type ParseError } from './serialize'

export type ImportResult =
  | { ok: true; graph: Graph }
  | { ok: false; format: 'json'; error: ParseError }
  | { ok: false; format: 'dsl'; errors: GraphDslError[] }

/** Imports a graph from text: JSON when the first non-whitespace character (after an optional BOM) is `{`, otherwise the DSL. */
export function parseAnyGraph(text: string): ImportResult {
  const body = text.startsWith('﻿') ? text.slice(1) : text
  if (body.trimStart().startsWith('{')) {
    const r = parseGraph(body)
    if (r.ok) return r
    const { ok: _ok, ...error } = r
    return { ok: false, format: 'json', error }
  }
  const r = parseGraphDsl(body)
  return r.ok ? r : { ok: false, format: 'dsl', errors: r.errors }
}
