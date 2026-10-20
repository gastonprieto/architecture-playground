import type { Graph } from '../engine/types'
import { nextClientIp } from './clientIp'
import { CLIENT_COLORS } from './colors'

/** The color for a new Cliente: the first palette color no Cliente uses; when all are taken, it cycles. */
export function nextClientColor(graph: Graph): string {
  const clients = graph.nodes.filter((n) => n.type === 'client')
  const used = new Set(clients.map((n) => n.config.color))
  return CLIENT_COLORS.find((c) => !used.has(c)) ?? CLIENT_COLORS[clients.length % CLIENT_COLORS.length]
}

/**
 * Fills in what older graphs lack: each Cliente without a color gets the next free palette color
 * and each one without an `ip` key the next free IP, in node order. Values already there (an empty
 * IP included) are kept. Returns `graph` itself when nothing was missing. Run where a graph enters
 * the editor (boot, link, import, preset), not in the engine.
 */
export function backfillClients(graph: Graph): Graph {
  const missing = (c: Record<string, unknown>) => typeof c.color !== 'string' || c.color === '' || typeof c.ip !== 'string'
  if (!graph.nodes.some((n) => n.type === 'client' && missing(n.config))) return graph
  // Assign in node order, looking only at what is already settled (existing values and earlier fills).
  const settled: Graph = { nodes: [], edges: [] }
  for (const n of graph.nodes) if (n.type === 'client' && !missing(n.config)) settled.nodes.push(n)
  const out = graph.nodes.map((n) => {
    if (n.type !== 'client' || !missing(n.config)) return n
    const config = { ...n.config }
    const known = { nodes: settled.nodes, edges: [] }
    if (typeof config.color !== 'string' || config.color === '') config.color = nextClientColor(known)
    if (typeof config.ip !== 'string') config.ip = nextClientIp(known)
    const filled = { ...n, config }
    settled.nodes.push(filled)
    return filled
  })
  return { ...graph, nodes: out }
}
