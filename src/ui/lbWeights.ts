import type { EdgeId, Graph, GraphEdge, NodeId } from '../engine/types'
import { sharePercents } from '../engine/weights'

/** True when `nodeId` is a load balancer using the weighted algorithm (its out-edges carry weights). */
export function isWeightedLb(graph: Graph, nodeId: NodeId): boolean {
  const n = graph.nodes.find((x) => x.id === nodeId)
  return n?.type === 'load-balancer' && n.config.algorithm === 'weighted'
}

/**
 * The outgoing edges of `lbId` with each one's effective share of the traffic in %, and whether its
 * target is down (with health checks on, the live split then goes to the others).
 */
export function lbShares(graph: Graph, lbId: NodeId): { edge: GraphEdge; share: number; down: boolean }[] {
  const out = graph.edges.filter((e) => e.source === lbId)
  const pct = sharePercents(out.map((e) => e.weight))
  const isDown = (id: NodeId) => graph.nodes.find((n) => n.id === id)?.config.up === false
  return out.map((edge, i) => ({ edge, share: pct[i], down: isDown(edge.target) }))
}

/** Share and down flag of every edge leaving a weighted LB (what the canvas labels show). */
export function weightedEdgeLabels(graph: Graph): Record<EdgeId, { share: number; down: boolean }> {
  const out: Record<EdgeId, { share: number; down: boolean }> = {}
  for (const n of graph.nodes) {
    if (!isWeightedLb(graph, n.id)) continue
    for (const { edge, share, down } of lbShares(graph, n.id)) out[edge.id] = { share, down }
  }
  return out
}

/** Effective % of every edge leaving a weighted LB (the canvas shows it as the edge label). */
export function weightedEdgeShares(graph: Graph): Record<EdgeId, number> {
  const out: Record<EdgeId, number> = {}
  for (const n of graph.nodes) {
    if (!isWeightedLb(graph, n.id)) continue
    for (const { edge, share } of lbShares(graph, n.id)) out[edge.id] = share
  }
  return out
}
