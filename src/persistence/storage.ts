import type { Graph } from '../engine/types'
import { parseGraph, serializeGraph } from './serialize'

export const STORAGE_KEY = 'nodarium:graph'
/** Where the graph lived before the rename to Nodarium: read when there is no newer copy. */
export const LEGACY_STORAGE_KEY = 'architecture-playground:graph'

export function saveLocal(g: Graph): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeGraph(g))
  } catch {
    /* storage unavailable or full: persistence is best-effort */
  }
}

export function loadLocal(): Graph | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (text === null) return null
    const r = parseGraph(text)
    return r.ok ? r.graph : null
  } catch {
    return null
  }
}
