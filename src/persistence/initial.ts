import type { Graph } from '../engine/types'
import { presets } from '../presets'
import { decodeHash } from './hash'
import { loadLocal } from './storage'

const currentHash = (): string => {
  try {
    return globalThis.location?.hash ?? ''
  } catch {
    return ''
  }
}

/**
 * Startup graph: URL hash, then localStorage, then the load-balancer preset. `onHashLoaded` runs
 * when the graph came from the hash (the app clears it so a reload does not bring the link back).
 */
export function initialGraph(hash: string = currentHash(), onHashLoaded?: () => void): Graph {
  const fromHash = decodeHash(hash)
  if (fromHash) {
    onHashLoaded?.()
    return fromHash
  }
  return loadLocal() ?? presets.find((p) => p.id === 'load-balancer')!.graph
}

/** Drops the hash from the address bar without adding a history entry. */
export function clearLocationHash(): void {
  try {
    globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search)
  } catch {
    // No history API (non-browser environment): nothing to clear.
  }
}
