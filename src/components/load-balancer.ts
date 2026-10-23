import { defineComponent, type Ctx, type OutEdge } from '../engine/registry'
import type { Message, NodeId } from '../engine/types'
import { effectiveWeights } from '../engine/weights'

export type LbAlgorithm = 'round-robin' | 'least-connections' | 'random' | 'ip-hash' | 'weighted'

export interface LoadBalancerConfig {
  name: string
  algorithm: LbAlgorithm
  healthChecks: boolean
  /** Sticky sessions: a request whose session cookie is known goes to the target that issued it. */
  sticky: boolean
}

export interface LoadBalancerState {
  /** Round-robin cursor. */
  next: number
  /** Requests currently forwarded to each target. */
  inflight: Record<NodeId, number>
  /** Forwarded request id → the target it went to. */
  pending: Record<string, NodeId>
  /** Smooth weighted round-robin running weights per target. */
  current: Record<NodeId, number>
  /** Sticky sessions: session id → the target it is pinned to (learned from `setSession`). */
  sticky: Record<string, NodeId>
  /** Advanced view: forwarded requests per target, broken down by originating client. */
  routed: Record<NodeId, RoutedTarget>
}

/** How many requests a target received, split by the client that originated them. */
export interface RoutedTarget {
  total: number
  byClient: Record<string, { n: number; name: string; color?: string }>
}

/** A stable key for the client that sent `msg` (ip, then id, then name). */
function clientKey(msg: Message): string {
  return nonEmpty(msg.meta.clientIp) ?? nonEmpty(msg.meta.clientId) ?? nonEmpty(msg.meta.clientName) ?? 'anon'
}

/** Record that `chosen` served one request from `msg`'s client (advanced view bookkeeping). */
function recordRoute(st: LoadBalancerState, chosen: NodeId, msg: Message): void {
  const bucket = (st.routed[chosen] ??= { total: 0, byClient: {} })
  bucket.total++
  const key = clientKey(msg)
  const c = (bucket.byClient[key] ??= { n: 0, name: nonEmpty(msg.meta.clientName) ?? key, color: nonEmpty(msg.meta.clientColor) })
  c.n++
  // The name/color can arrive later than the first request; keep the latest non-empty ones.
  const name = nonEmpty(msg.meta.clientName)
  if (name) c.name = name
  const color = nonEmpty(msg.meta.clientColor)
  if (color) c.color = color
}

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

/** The value as a trimmed string, or undefined when it is missing or blank. */
function nonEmpty(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? undefined : s
}

/** The target the configured algorithm picks for `msg` among `targets` (non-empty). */
function pick(msg: Message, ctx: Ctx<LoadBalancerConfig, LoadBalancerState>, targets: OutEdge[]): NodeId {
  const st = ctx.state
  let chosen = targets[0].target
  switch (ctx.config.algorithm) {
    case 'least-connections': {
      let best = Infinity
      for (const o of targets) {
        const n = st.inflight[o.target] ?? 0
        if (n < best) {
          best = n
          chosen = o.target
        }
      }
      break
    }
    case 'random':
      chosen = targets[Math.floor(ctx.random() * targets.length)].target
      break
    case 'ip-hash': {
      const ip = nonEmpty(msg.meta.clientIp)
      chosen = targets[hash(ip ?? nonEmpty(msg.meta.clientId) ?? msg.id) % targets.length].target
      break
    }
    case 'weighted': {
      // Smooth weighted round-robin (nginx style) over the connection weights: deterministic and
      // evenly interleaved. Weight 0 is never chosen (unless all are 0: equal split).
      const weights = effectiveWeights(targets.map((o) => o.weight))
      let total = 0
      let best = -Infinity
      for (const [i, o] of targets.entries()) {
        const w = weights[i]
        if (w <= 0) continue
        total += w
        const cur = (st.current[o.target] ?? 0) + w
        st.current[o.target] = cur
        if (cur > best) {
          best = cur
          chosen = o.target
        }
      }
      st.current[chosen] -= total
      break
    }
    default:
      chosen = targets[st.next % targets.length].target
      st.next = (st.next + 1) % targets.length
  }
  return chosen
}

export const loadBalancer = defineComponent<LoadBalancerConfig, LoadBalancerState>({
  type: 'load-balancer',
  label: 'Load Balancer',
  icon: '⚖️',
  color: 'hc',
  group: 'edge',
  config: {
    algorithm: {
      type: 'select',
      label: 'Algoritmo',
      default: 'round-robin',
      options: [
        { value: 'round-robin', label: 'Round Robin' },
        { value: 'least-connections', label: 'Least Connections' },
        { value: 'random', label: 'Random' },
        { value: 'ip-hash', label: 'IP Hash' },
        { value: 'weighted', label: 'Weighted' },
      ],
    },
    healthChecks: { type: 'boolean', label: 'Health checks', default: false },
    sticky: { type: 'boolean', label: 'Sticky sessions', default: false },
  },
  initialState: () => ({ next: 0, inflight: {}, pending: {}, current: {}, sticky: {}, routed: {} }),
  onMessage(msg, ctx) {
    let targets = ctx.outputs()
    if (ctx.config.healthChecks) targets = targets.filter((o) => ctx.peer(o.target)?.config.up !== false)
    if (targets.length === 0) {
      ctx.drop(msg, 'no-targets', 503)
      return
    }
    const st = ctx.state
    st.sticky ??= {}
    const session = ctx.config.sticky ? nonEmpty(msg.meta.sessionId) : undefined
    // Sticky wins over any algorithm when the cookie is known and its target is still available
    // (still connected and, with health checks, up). Otherwise the algorithm picks and the cookie is re-pinned.
    const pinned = session === undefined ? undefined : st.sticky[session]
    const chosen = pinned !== undefined && targets.some((o) => o.target === pinned) ? pinned : pick(msg, ctx, targets)
    if (session !== undefined) st.sticky[session] = chosen
    st.pending[msg.id] = chosen
    st.inflight[chosen] = (st.inflight[chosen] ?? 0) + 1
    st.routed ??= {}
    recordRoute(st, chosen, msg)
    ctx.send(chosen, msg)
  },
  onResponse(res, ctx) {
    const st = ctx.state
    const target = res.replyTo === undefined ? undefined : st.pending[res.replyTo]
    if (target !== undefined) {
      delete st.pending[res.replyTo!]
      st.inflight[target] = Math.max(0, (st.inflight[target] ?? 0) - 1)
    }
    if (ctx.config.sticky) {
      st.sticky ??= {}
      // A lost session never comes back (the user logs in again with a new id): forget its pin.
      if (res.code === 401 && res.meta.authError === 'session-lost') {
        const lost = nonEmpty(res.meta.sessionId)
        if (lost !== undefined) delete st.sticky[lost]
      }
      // A new session is pinned to the target that answered.
      const issued = nonEmpty(res.meta.setSession)
      if (issued !== undefined && target !== undefined) st.sticky[issued] = target
    }
    ctx.forwardResponse(res)
  },
})
