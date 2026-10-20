import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Graph } from '../engine/types'
import { parseGraph, serializeGraph } from './serialize'

const PREFIX = '#g='

export const encodeHash = (g: Graph): string => PREFIX + compressToEncodedURIComponent(serializeGraph(g))

export function decodeHash(hash: string): Graph | null {
  try {
    if (!hash.startsWith(PREFIX)) return null
    const text = decompressFromEncodedURIComponent(hash.slice(PREFIX.length))
    if (!text) return null
    const r = parseGraph(text)
    return r.ok ? r.graph : null
  } catch {
    return null
  }
}
