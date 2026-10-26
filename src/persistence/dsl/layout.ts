import type { Graph, NodeId } from '../../engine/types'
import { COL, ROW } from '../grid'

/**
 * Positions the nodes of `graph` that are not in `placed` (docs/graph-dsl-spec.md §8):
 * column = longest path from a source (cycles cut at DFS back edges), row = declaration order
 * refined by one barycenter pass, isolated nodes in column 0 below everything else.
 * Placed nodes are untouched and keep their cells occupied.
 */
export function layoutGraph(graph: Graph, placed: ReadonlySet<NodeId>): Graph {
  const ids = graph.nodes.map((n) => n.id)
  const back = backEdges(graph)
  const forward = graph.edges.filter((e) => !back.has(e.id))
  const connected = new Set(graph.edges.flatMap((e) => [e.source, e.target]))

  const column = columns(ids, forward)
  const maxColumn = Math.max(0, ...ids.filter((id) => connected.has(id)).map((id) => column.get(id)!))
  const order = rowOrder(ids.filter((id) => connected.has(id)), column, forward, maxColumn)

  const cells = new Map<NodeId, { col: number; row: number }>()
  const occupied = new Set<string>()
  const occupy = (id: NodeId, col: number, row: number) => {
    cells.set(id, { col, row })
    occupied.add(`${col},${row}`)
  }
  for (const node of graph.nodes) {
    if (placed.has(node.id)) occupy(node.id, Math.round(node.position.x / COL), Math.round(node.position.y / ROW))
  }
  for (let col = 0; col <= maxColumn; col++) {
    let row = 0
    for (const id of order[col]) {
      if (placed.has(id)) continue
      while (occupied.has(`${col},${row}`)) row++
      occupy(id, col, row)
    }
  }
  let below = Math.max(-1, ...[...cells.values()].map((c) => c.row)) + 1
  for (const id of ids) {
    if (placed.has(id) || connected.has(id)) continue
    occupy(id, 0, below++)
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const cell = cells.get(node.id)
      return placed.has(node.id) || !cell ? node : { ...node, position: { x: cell.col * COL, y: cell.row * ROW } }
    }),
  }
}

/** Ids of the edges that point to a node still on the DFS stack. */
function backEdges(graph: Graph): Set<string> {
  const outgoing = new Map<NodeId, Graph['edges']>()
  for (const e of graph.edges) outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e])
  const back = new Set<string>()
  const visited = new Set<NodeId>()
  const onStack = new Set<NodeId>()
  const visit = (id: NodeId) => {
    visited.add(id)
    onStack.add(id)
    for (const e of outgoing.get(id) ?? []) {
      if (onStack.has(e.target)) back.add(e.id)
      else if (!visited.has(e.target)) visit(e.target)
    }
    onStack.delete(id)
  }
  for (const node of graph.nodes) if (!visited.has(node.id)) visit(node.id)
  return back
}

/** Longest path from a node without incoming edges, over the acyclic `edges`. */
function columns(ids: NodeId[], edges: Graph['edges']): Map<NodeId, number> {
  const column = new Map(ids.map((id) => [id, 0]))
  const pending = new Map(ids.map((id) => [id, 0]))
  for (const e of edges) pending.set(e.target, pending.get(e.target)! + 1)
  const queue = ids.filter((id) => pending.get(id) === 0)
  for (let i = 0; i < queue.length; i++) {
    for (const e of edges) {
      if (e.source !== queue[i]) continue
      column.set(e.target, Math.max(column.get(e.target)!, column.get(e.source)! + 1))
      pending.set(e.target, pending.get(e.target)! - 1)
      if (pending.get(e.target) === 0) queue.push(e.target)
    }
  }
  return column
}

/** Declaration order per column; columns 1.. are sorted by the mean row of their earlier-column predecessors. */
function rowOrder(ids: NodeId[], column: Map<NodeId, number>, edges: Graph['edges'], maxColumn: number): NodeId[][] {
  const order: NodeId[][] = Array.from({ length: maxColumn + 1 }, () => [])
  for (const id of ids) order[column.get(id)!].push(id)
  const rowIndex = new Map<NodeId, number>()
  order[0]?.forEach((id, row) => rowIndex.set(id, row))
  for (let col = 1; col <= maxColumn; col++) {
    const mean = (id: NodeId) => {
      const rows = edges.filter((e) => e.target === id && column.get(e.source)! < col).map((e) => rowIndex.get(e.source)!)
      return rows.length === 0 ? Infinity : rows.reduce((a, b) => a + b, 0) / rows.length
    }
    const keys = new Map(order[col].map((id) => [id, mean(id)]))
    order[col].sort((a, b) => {
      const ka = keys.get(a)!
      const kb = keys.get(b)!
      return ka === kb ? 0 : ka < kb ? -1 : 1
    })
    order[col].forEach((id, row) => rowIndex.set(id, row))
  }
  return order
}
