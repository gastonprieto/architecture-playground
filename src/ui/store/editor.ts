import { create } from 'zustand'
import { defaultRegistry } from '../../components/index'
import { defaultConfig } from '../../engine/registry'
import type { EdgeId, EdgeRule, Graph, NodeId } from '../../engine/types'

export type Selection = { kind: 'node' | 'edge'; id: string } | null

export interface EditorState {
  graph: Graph
  selection: Selection
  past: Graph[]
  future: Graph[]
  addNode(type: string, position: { x: number; y: number }): NodeId
  connect(source: NodeId, target: NodeId): EdgeId | null
  moveNode(id: NodeId, position: { x: number; y: number }, commit: boolean): void
  removeElements(ids: string[]): void
  updateNodeConfig(id: NodeId, patch: Record<string, unknown>): void
  setEdgeRule(id: EdgeId, rule: EdgeRule | undefined): void
  select(sel: Selection): void
  loadGraph(graph: Graph): void
  undo(): void
  redo(): void
}

const HISTORY_LIMIT = 100

const randomSuffix = () => {
  let s = ''
  while (s.length < 6) s += Math.random().toString(36).slice(2)
  return s.slice(0, 6)
}

/** Graph at the start of an in-progress drag (moveNode with commit=false). */
let dragBase: Graph | null = null

export const useEditor = create<EditorState>((set, get) => {
  /** Apply a committing mutation: push `prev` to history, clear redo. */
  const commit = (next: Graph, prev: Graph = get().graph, extra: Partial<EditorState> = {}) =>
    set((st) => ({ graph: next, past: [...st.past, prev].slice(-HISTORY_LIMIT), future: [], ...extra }))

  return {
    graph: { nodes: [], edges: [] },
    selection: null,
    past: [],
    future: [],

    addNode(type, position) {
      const id = `${type}-${randomSuffix()}`
      const def = defaultRegistry.get(type)
      const { graph } = get()
      commit({ ...graph, nodes: [...graph.nodes, { id, type, position, config: def ? defaultConfig(def) : {} }] })
      return id
    },

    connect(source, target) {
      const { graph } = get()
      if (source === target) return null
      if (graph.edges.some((e) => e.source === source && e.target === target)) return null
      const id = `edge-${randomSuffix()}`
      commit({ ...graph, edges: [...graph.edges, { id, source, target }] })
      return id
    },

    moveNode(id, position, isCommit) {
      const { graph } = get()
      const next = { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)) }
      if (!isCommit) {
        dragBase ??= graph
        set({ graph: next })
        return
      }
      const prev = dragBase ?? graph
      dragBase = null
      commit(next, prev)
    },

    removeElements(ids) {
      const { graph, selection } = get()
      const drop = new Set(ids)
      const next: Graph = {
        nodes: graph.nodes.filter((n) => !drop.has(n.id)),
        edges: graph.edges.filter((e) => !drop.has(e.id) && !drop.has(e.source) && !drop.has(e.target)),
      }
      commit(next, graph, selection && drop.has(selection.id) ? { selection: null } : {})
    },

    updateNodeConfig(id, patch) {
      const { graph } = get()
      commit({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)) })
    },

    setEdgeRule(id, rule) {
      const { graph } = get()
      commit({
        ...graph,
        edges: graph.edges.map((e) => {
          if (e.id !== id) return e
          const { rule: _old, ...rest } = e
          return rule ? { ...rest, rule } : rest
        }),
      })
    },

    select(selection) {
      set({ selection })
    },

    loadGraph(graph) {
      dragBase = null
      set({ graph, selection: null, past: [], future: [] })
    },

    undo() {
      const { past, graph, future } = get()
      if (past.length === 0) return
      set({ graph: past[past.length - 1], past: past.slice(0, -1), future: [graph, ...future] })
    },

    redo() {
      const { past, graph, future } = get()
      if (future.length === 0) return
      set({ graph: future[0], past: [...past, graph], future: future.slice(1) })
    },
  }
})
