import type { Graph } from '../engine/types'

const PREFIX = '10.0.0.'

/** The IP for a new Cliente: `10.0.0.N` with the smallest N ≥ 1 no Cliente in `graph` uses yet. */
export function nextClientIp(graph: Graph): string {
  const used = new Set<number>()
  for (const n of graph.nodes) {
    if (n.type !== 'client' || typeof n.config.ip !== 'string') continue
    const ip = n.config.ip.trim()
    if (ip.startsWith(PREFIX) && /^\d+$/.test(ip.slice(PREFIX.length))) used.add(Number(ip.slice(PREFIX.length)))
  }
  let n = 1
  while (used.has(n)) n++
  return `${PREFIX}${n}`
}
