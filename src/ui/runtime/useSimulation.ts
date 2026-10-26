import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { defaultRegistry } from '../../components/index'
import { Simulation } from '../../engine/simulation'
import type { Graph, Message, MetricsSnapshot, NodeId, NodeStats } from '../../engine/types'
import { useEditor } from '../store/editor'
import { ZERO_METRICS, useRuntime } from './runtimeStore'

/** Longest real-time slice one frame may simulate (a background tab must not jump minutes ahead). */
export const MAX_FRAME_MS = 100
/** Sim-ms per real ms at "1x": the animation reads best at half real time. */
export const BASE_RATE = 0.5
/** Sim-ms one "Paso" advances. */
export const STEP_MS = 100

export type FrameListener = (sim: Simulation) => void

export interface SimApi {
  sim: Simulation
  play(): void
  pause(): void
  toggle(): void
  step(): void
  reset(): void
  setSpeed(speed: number): void
  runAction(nodeId: NodeId, action: string): void
  /** Called once per animation frame, after the simulation advanced and the store was flushed. */
  onFrame(fn: FrameListener): () => void
}

export const SimContext = createContext<SimApi | null>(null)

/** The simulation provided by <App/>, or null outside of it (tests rendering parts alone). */
export const useSim = (): SimApi | null => useContext(SimContext)

const makeSim = (graph: Graph) => {
  const sim = new Simulation(graph, { seed: 1, registry: defaultRegistry })
  sim.setFlowOnly(useRuntime.getState().flowOnly)
  return sim
}

/** Cells a node draws per queue or lane; the rest is shown as "+N". */
export const UI_CELLS = 12

/** The drawable head of a buffer (first UI_CELLS messages) and its full length. */
export interface CellsView {
  head: Message[]
  total: number
}

/**
 * Queue/DLQ items and broker lanes, copied so React sees new references (components mutate in
 * place). Only the head is copied: a long buffer costs the same as a short one. `cookies` (Cliente:
 * users logged in) and `sessions` (Servicio/Worker/Suscriptor in memory, Base de datos) are counts,
 * and so are the cache ones (Cache, Reverse Proxy): stored keys, HITs and MISSes.
 */
export type UiState = {
  items?: CellsView
  lanes?: Record<NodeId, CellsView>
  cookies?: number
  sessions?: number
  cacheKeys?: number
  cacheHits?: number
  cacheMisses?: number
  lb?: LbView
  broker?: BrokerView
}

/** Live per-output counters of a Broker for the advanced inspector view (lanes hold the depth). */
export type BrokerView = {
  inFlight: Record<NodeId, number>
  delivered: Record<NodeId, number>
  acks: Record<NodeId, { ok: number; errors: number }>
}

/** Live Load Balancer state the advanced inspector view draws. */
export type LbView = {
  next: number
  inflight: Record<NodeId, number>
  current: Record<NodeId, number>
  stickyCount: number
  routed: Record<NodeId, LbRoutedView>
}
export type LbRoutedView = {
  total: number
  byClient: Record<string, { n: number; name: string; color?: string }>
}

type CacheCounts = { keys: unknown[]; hits: number; misses: number }
const isCacheState = (s: { keys?: unknown; hits?: unknown; misses?: unknown }): s is CacheCounts =>
  Array.isArray(s.keys) && typeof s.hits === 'number' && typeof s.misses === 'number'

/** The Load Balancer state: the only one with a `routed` map plus `inflight`/`current`/`next`. */
type LbState = {
  next: number
  inflight: Record<NodeId, number>
  current: Record<NodeId, number>
  sticky: Record<string, NodeId>
  routed: Record<NodeId, LbRoutedView>
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isLbState = (s: Record<string, unknown>): s is LbState =>
  typeof s.next === 'number' && isObj(s.inflight) && isObj(s.current) && isObj(s.routed)

/** The Broker state: lanes plus its per-output counters. */
type BrokerState = BrokerView & { lanes: Record<NodeId, Message[]> }
const isBrokerState = (s: Record<string, unknown>): s is BrokerState => isObj(s.lanes) && isObj(s.inFlight) && isObj(s.delivered) && isObj(s.acks)

const countsSig = (r: Record<string, unknown>) =>
  Object.entries(r)
    .map(([k, v]) => `${k}:${isObj(v) ? `${v.ok}/${v.errors}` : v}`)
    .join(',')

const brokerCopy = (s: BrokerState): BrokerView => ({
  inFlight: { ...s.inFlight },
  delivered: { ...s.delivered },
  acks: Object.fromEntries(Object.entries(s.acks).map(([k, v]) => [k, { ...v }])),
})

/** Fingerprint: changes when routing totals, inflight, the cursor or the sticky map move. */
function lbSignature(s: LbState): string {
  const routed = Object.entries(s.routed)
    .map(([k, v]) => `${k}:${v.total}`)
    .join(',')
  const inflight = Object.entries(s.inflight)
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
  return `lb|n:${s.next}|r:${routed}|f:${inflight}|s:${Object.keys(s.sticky ?? {}).length}`
}

const sigOf = (arr: Message[]) => `${arr.length}:${arr[0]?.id ?? ''}:${arr[arr.length - 1]?.id ?? ''}`

const loggedIn = (cookies: unknown[]) => cookies.filter(Boolean).length

/** A cheap fingerprint of the drawable parts of a component state, or null if it has none. */
export function uiSignature(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  const s = state as { items?: unknown; lanes?: unknown; cookies?: unknown; sessions?: unknown; keys?: unknown; hits?: unknown; misses?: unknown; next?: unknown; inflight?: unknown; current?: unknown; routed?: unknown }
  if (Array.isArray(s.items)) return sigOf(s.items as Message[])
  if (typeof s.lanes === 'object' && s.lanes !== null) {
    const lanes = Object.entries(s.lanes as Record<string, Message[]>)
      .map(([k, v]) => `${k}=${sigOf(v)}`)
      .join('|')
    const b = state as Record<string, unknown>
    return isBrokerState(b) ? `${lanes}|f:${countsSig(b.inFlight)}|d:${countsSig(b.delivered)}|a:${countsSig(b.acks)}` : lanes
  }
  if (Array.isArray(s.cookies)) return `c:${loggedIn(s.cookies)}`
  if (Array.isArray(s.sessions)) return `s:${s.sessions.length}`
  if (isCacheState(s)) return `k:${s.keys.length}:${s.hits}:${s.misses}`
  if (isLbState(s)) return lbSignature(s)
  return null
}

const view = (arr: Message[]): CellsView => ({ head: arr.slice(0, UI_CELLS), total: arr.length })

/** A deep-enough copy of the LB view so React sees new references (the component mutates in place). */
function lbCopy(s: LbState): LbView {
  const routed: Record<NodeId, LbRoutedView> = {}
  for (const [target, r] of Object.entries(s.routed)) {
    const byClient: LbRoutedView['byClient'] = {}
    for (const [k, c] of Object.entries(r.byClient)) byClient[k] = { ...c }
    routed[target] = { total: r.total, byClient }
  }
  return {
    next: s.next,
    inflight: { ...s.inflight },
    current: { ...s.current },
    stickyCount: Object.keys(s.sticky ?? {}).length,
    routed,
  }
}

export function uiCopy(state: unknown): UiState {
  const s = state as { items?: Message[]; lanes?: Record<NodeId, Message[]>; cookies?: unknown[]; sessions?: unknown[]; keys?: unknown; hits?: unknown; misses?: unknown; next?: unknown; inflight?: unknown; current?: unknown; routed?: unknown }
  if (Array.isArray(s.items)) return { items: view(s.items) }
  if (typeof s.lanes === 'object' && s.lanes !== null) {
    const lanes = Object.fromEntries(Object.entries(s.lanes).map(([k, v]) => [k, view(v)]))
    const b = state as Record<string, unknown>
    return isBrokerState(b) ? { lanes, broker: brokerCopy(b) } : { lanes }
  }
  if (Array.isArray(s.cookies)) return { cookies: loggedIn(s.cookies) }
  if (Array.isArray(s.sessions)) return { sessions: s.sessions.length }
  if (isCacheState(s)) return { cacheKeys: s.keys.length, cacheHits: s.hits, cacheMisses: s.misses }
  if (isLbState(s)) return { lb: lbCopy(s) }
  return {}
}

/**
 * Owns the single Simulation of the app: keeps it in sync with the editor graph, drives it from a
 * requestAnimationFrame loop and flushes its counters to the runtime store at most once per frame.
 * Call it once (in <App/>) and share the result through SimContext.
 */
export function useSimulation(): SimApi {
  const [sim, setSim] = useState(() => makeSim(useEditor.getState().graph))
  const simRef = useRef(sim)
  const frameFns = useRef(new Set<FrameListener>())
  // Pending flush data of the current simulation.
  const pendingStats = useRef<Record<NodeId, NodeStats>>({})
  const pendingMetrics = useRef<MetricsSnapshot | null>(null)
  const stateSigs = useRef<Record<NodeId, string>>({})

  // Flow-only toggle → simulation.
  useEffect(
    () =>
      useRuntime.subscribe((s, prev) => {
        if (s.flowOnly !== prev.flowOnly) simRef.current.setFlowOnly(s.flowOnly)
      }),
    [],
  )

  // Editor graph → simulation, on every graph change (not on every render).
  useEffect(() => {
    const apply = (g: Graph) => {
      try {
        simRef.current.setGraph(g)
      } catch (err) {
        console.error('setGraph failed', err)
      }
      // Forget counters of removed nodes, so a node brought back (undo) starts from zero like in the engine.
      const ids = new Set(g.nodes.map((n) => n.id))
      const { stats, states } = useRuntime.getState()
      const gone = Object.keys(stats).filter((id) => !ids.has(id))
      const goneStates = Object.keys(states).filter((id) => !ids.has(id))
      for (const id of goneStates) delete stateSigs.current[id]
      if (gone.length > 0 || goneStates.length > 0) {
        const keep = <T,>(r: Record<NodeId, T>) => Object.fromEntries(Object.entries(r).filter(([id]) => ids.has(id)))
        useRuntime.setState({ stats: keep(stats), states: keep(states) })
      }
    }
    apply(useEditor.getState().graph)
    return useEditor.subscribe((s, prev) => {
      if (s.graph !== prev.graph) apply(s.graph)
    })
  }, [])

  // Collect counters from the current simulation.
  useEffect(() => {
    const offStats = sim.on('node:stats', ({ nodeId, stats }) => {
      pendingStats.current[nodeId] = stats
    })
    const offMetrics = sim.on('metrics:tick', (m) => {
      pendingMetrics.current = m
    })
    return () => {
      offStats()
      offMetrics()
    }
  }, [sim])

  const flush = useCallback(() => {
    const s = simRef.current
    const patch: Partial<ReturnType<typeof useRuntime.getState>> = {}
    const rt = useRuntime.getState()
    if (Object.keys(pendingStats.current).length > 0) {
      patch.stats = { ...rt.stats, ...pendingStats.current }
      pendingStats.current = {}
    }
    if (pendingMetrics.current) {
      patch.metrics = pendingMetrics.current
      pendingMetrics.current = null
    }
    let states: Record<NodeId, unknown> | null = null
    for (const n of useEditor.getState().graph.nodes) {
      const st = s.nodeState(n.id)
      const sig = uiSignature(st)
      if (sig === null || stateSigs.current[n.id] === sig) continue
      stateSigs.current[n.id] = sig
      states ??= { ...rt.states }
      states[n.id] = uiCopy(st)
    }
    if (states) patch.states = states
    if (Object.keys(patch).length > 0) useRuntime.setState(patch)
  }, [])

  // The animation loop: advance while playing, flush, then notify the frame listeners.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return
    let raf = 0
    let last = performance.now()
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const realDt = Math.max(0, t - last)
      last = t
      const s = simRef.current
      const { playing, speed } = useRuntime.getState()
      if (playing) {
        try {
          s.advance(Math.min(realDt, MAX_FRAME_MS) * speed * BASE_RATE)
        } catch (err) {
          // A throwing component must not kill the loop.
          console.error('Simulation step failed', err)
        }
      }
      flush()
      for (const fn of frameFns.current) {
        try {
          fn(s)
        } catch (err) {
          console.error('Frame listener failed', err)
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [flush])

  const reset = useCallback(() => {
    const next = makeSim(useEditor.getState().graph)
    simRef.current = next
    pendingStats.current = {}
    pendingMetrics.current = null
    stateSigs.current = {}
    useRuntime.setState({ stats: {}, states: {}, metrics: ZERO_METRICS })
    setSim(next)
  }, [])

  const step = useCallback(() => {
    try {
      simRef.current.advance(STEP_MS)
    } catch (err) {
      console.error('Simulation step failed', err)
    }
  }, [])

  const runAction = useCallback((nodeId: NodeId, action: string) => {
    try {
      simRef.current.runAction(nodeId, action)
    } catch (err) {
      console.error(`Action ${action} failed`, err)
    }
  }, [])

  const onFrame = useCallback((fn: FrameListener) => {
    frameFns.current.add(fn)
    return () => {
      frameFns.current.delete(fn)
    }
  }, [])

  return useMemo<SimApi>(
    () => ({
      sim,
      play: () => useRuntime.setState({ playing: true }),
      pause: () => useRuntime.setState({ playing: false }),
      toggle: () => useRuntime.setState((s) => ({ playing: !s.playing })),
      step,
      reset,
      setSpeed: (speed: number) => useRuntime.setState({ speed }),
      runAction,
      onFrame,
    }),
    [sim, step, reset, runAction, onFrame],
  )
}
