import { defineComponent } from '../engine/registry'
import type { NodeId } from '../engine/types'

export type LbAlgorithm = 'round-robin' | 'least-connections' | 'random' | 'ip-hash' | 'weighted'

export interface LoadBalancerConfig {
  name: string
  algorithm: LbAlgorithm
  healthChecks: boolean
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

export const loadBalancer = defineComponent<LoadBalancerConfig, LoadBalancerState>({
  type: 'load-balancer',
  label: 'Load Balancer',
  icon: '⚖️',
  color: 'hc',
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
  },
  initialState: () => ({ next: 0, inflight: {}, pending: {}, current: {} }),
  onMessage(msg, ctx) {
    let targets = ctx.outputs()
    if (ctx.config.healthChecks) targets = targets.filter((o) => ctx.peer(o.target)?.config.up !== false)
    if (targets.length === 0) {
      ctx.drop(msg, 'no-targets', 503)
      return
    }
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
        // "<ip> → <target name>" so the class sees which server each client is pinned to.
        const who = ip ?? nonEmpty(msg.meta.clientName) ?? nonEmpty(msg.meta.clientId) ?? msg.id
        const targetName = nonEmpty(ctx.peer(chosen)?.config.name) ?? chosen
        ctx.label(`${who} → ${targetName}`, 'hc')
        break
      }
      case 'weighted': {
        // Smooth weighted round-robin (nginx style): deterministic and evenly interleaved.
        const weightOf = (id: NodeId) => {
          const c = ctx.peer(id)?.config.capacity
          return typeof c === 'number' && c > 0 ? c : 1
        }
        let total = 0
        let best = -Infinity
        for (const o of targets) {
          const w = weightOf(o.target)
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
    st.pending[msg.id] = chosen
    st.inflight[chosen] = (st.inflight[chosen] ?? 0) + 1
    ctx.send(chosen, msg)
  },
  onResponse(res, ctx) {
    const target = res.replyTo === undefined ? undefined : ctx.state.pending[res.replyTo]
    if (target !== undefined) {
      delete ctx.state.pending[res.replyTo!]
      ctx.state.inflight[target] = Math.max(0, (ctx.state.inflight[target] ?? 0) - 1)
    }
    ctx.forwardResponse(res)
  },
})
