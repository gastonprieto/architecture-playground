import { defineComponent, type Ctx } from '../engine/registry'
import { matchesEvent } from '../engine/rules'
import type { Message, NodeId } from '../engine/types'
import { pushReady, release } from './shared/push'

export interface BrokerConfig {
  name: string
}

export interface BrokerState {
  /** One buffered lane per subscriber: events waiting for a free slot, oldest first (UI cells). */
  lanes: Record<NodeId, Message[]>
  /** Events sent to each subscriber and not acked yet. */
  inFlight: Record<NodeId, number>
  /** Lane copy id → the subscriber it was sent to, until its ack/nack arrives. */
  pending: Record<string, NodeId>
}

type BrokerCtx = Ctx<BrokerConfig, BrokerState>

/**
 * Pushes waiting events from each lane to its subscriber while it is up and has free slots. Only
 * lanes of current outputs are pumped: a lane whose edge was removed just keeps its events.
 */
function pump(ctx: BrokerCtx): void {
  const st = ctx.state
  const targets = ctx.outputs().map((o) => o.target).filter((t) => (st.lanes[t]?.length ?? 0) > 0)
  if (targets.length === 0) return
  for (const p of pushReady(ctx, st.lanes, st.inFlight, targets)) st.pending[p.msg.id] = p.target
}

/**
 * Fans `ev` out to every output whose rule matches its eventType, one fresh copy per output (so ids
 * are distinct). Queues get theirs immediately (they never ack events); subscribers get theirs
 * through their lane. No match → 'sin suscriptores'.
 */
function publish(ctx: BrokerCtx, ev: Message): void {
  const eventType = ev.meta.eventType ?? ''
  const matching = ctx.outputs().filter((o) => matchesEvent(o.rule, eventType))
  if (matching.length === 0) {
    ctx.label('sin suscriptores', 'slow')
    ctx.drop(ev, 'sin suscriptores')
    return
  }
  for (const out of matching) {
    const copy = ctx.newMessage('event', ev.meta, ev)
    if (out.targetType === 'queue') ctx.send(out.target, copy)
    else (ctx.state.lanes[out.target] ??= []).push(copy)
  }
  pump(ctx)
}

export const broker = defineComponent<BrokerConfig, BrokerState>({
  type: 'broker',
  label: 'Broker',
  icon: '📡',
  color: 'hc',
  config: {},
  initialState: () => ({ lanes: {}, inFlight: {}, pending: {} }),
  onMessage(msg, ctx) {
    if (msg.kind === 'request') {
      ctx.reply(msg, { status: 'ok', code: 202 })
      ctx.label('202', 'ok')
      publish(ctx, ctx.newMessage('event', { ...msg.meta, eventType: msg.meta.eventType ?? msg.meta.path }, msg))
    } else {
      publish(ctx, msg)
    }
  },
  onResponse(res, ctx) {
    const target = res.replyTo === undefined ? undefined : ctx.state.pending[res.replyTo]
    if (target === undefined) {
      ctx.forwardResponse(res)
      return
    }
    // Ack or nack alike: the slot is freed. No redelivery in the MVP.
    delete ctx.state.pending[res.replyTo!]
    release(ctx.state.inFlight, target)
    pump(ctx)
  },
  // Picks up subscribers that came back up or got more capacity through a config change.
  onTick(ctx) {
    pump(ctx)
  },
})
