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

/** Startup graph: URL hash, then localStorage, then the load-balancer preset. */
export function initialGraph(hash: string = currentHash()): Graph {
  return decodeHash(hash) ?? loadLocal() ?? presets.find((p) => p.id === 'load-balancer')!.graph
}
