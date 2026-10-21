import type { Graph } from '../engine/types'
import { backfillClients } from './clientColor'

/**
 * Upgrades fields older graphs used: a Reverse Proxy's `authFailRate` (the removed random "Rechazo
 * auth") becomes `auth: 'credentials'` when it was a number > 0, and is dropped in every case
 * (sessions spec §8). Pure: returns `graph` itself when nothing changed.
 */
export function migrateGraph(graph: Graph): Graph {
  if (!graph.nodes.some((n) => n.type === 'reverse-proxy' && 'authFailRate' in n.config)) return graph
  const nodes = graph.nodes.map((n) => {
    if (n.type !== 'reverse-proxy' || !('authFailRate' in n.config)) return n
    const { authFailRate, ...rest } = n.config
    const rejected = typeof authFailRate === 'number' && authFailRate > 0
    return { ...n, config: rejected ? { ...rest, auth: 'credentials' } : rest }
  })
  return { ...graph, nodes }
}

/** Everything a graph needs when it enters the editor (boot, link, import, preset). */
export const prepareGraph = (graph: Graph): Graph => backfillClients(migrateGraph(graph))
