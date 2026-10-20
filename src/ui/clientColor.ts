import type { Graph } from '../engine/types'
import { CLIENT_COLORS } from './colors'

/** The color for a new Cliente: the first palette color no Cliente uses; when all are taken, it cycles. */
export function nextClientColor(graph: Graph): string {
  const clients = graph.nodes.filter((n) => n.type === 'client')
  const used = new Set(clients.map((n) => n.config.color))
  return CLIENT_COLORS.find((c) => !used.has(c)) ?? CLIENT_COLORS[clients.length % CLIENT_COLORS.length]
}
