import { defineComponent, processingFields, type Ctx } from '../engine/registry'
import { matchesEvent } from '../engine/rules'
import type { Message, NodeId } from '../engine/types'
import { isFree, release } from './shared/push'

export interface BrokerConfig {
  name: string
  up: boolean
}

export interface BrokerState {
  /** One buffered lane per subscriber: events waiting for that subscriber to pull, oldest first (UI cells). */
  lanes: Record<NodeId, Message[]>
  /** Events handed to each subscriber and not acked yet. */
  inFlight: Record<NodeId, number>
  /** Lane copy id → the subscriber it was handed to, until its ack/nack arrives. */
  pending: Record<string, NodeId>
  /** Events handed to each output (subscribers on pull, queues on publish), for the inspector. */
  delivered: Record<NodeId, number>
  /** Acks (ok) and nacks (errors) each subscriber answered. Queues never ack. */
  acks: Record<NodeId, { ok: number; errors: number }>
}

type BrokerCtx = Ctx<BrokerConfig, BrokerState>

/**
 * Fans `ev` out to every output whose rule matches its eventType, one fresh copy per output (so ids
 * are distinct). Queues get theirs immediately (fire-and-forget: they never ack events and are
 * themselves pulled by their workers); subscribers get theirs buffered in their lane, to pull. No
 * match → 'no-subscribers'.
 */
function publish(ctx: BrokerCtx, ev: Message): void {
  const eventType = ev.meta.eventType ?? ''
  const matching = ctx.outputs().filter((o) => matchesEvent(o.rule, eventType))
  if (matching.length === 0) {
    ctx.label('no-subscribers', 'slow')
    ctx.drop(ev, 'no-subscribers')
    return
  }
  for (const out of matching) {
    const copy = ctx.newMessage('event', ev.meta, ev)
    if (out.targetType === 'queue') {
      ctx.send(out.target, copy)
      ctx.state.delivered[out.target] = (ctx.state.delivered[out.target] ?? 0) + 1
    } else (ctx.state.lanes[out.target] ??= []).push(copy)
  }
}

export const broker = defineComponent<BrokerConfig, BrokerState>({
  type: 'broker',
  label: 'Broker',
  icon: '📣',
  color: 'hc',
  group: 'messaging',
  config: {
    up: processingFields.up,
  },
  initialState: () => ({ lanes: {}, inFlight: {}, pending: {}, delivered: {}, acks: {} }),
  onMessage(msg, ctx) {
    if (msg.kind === 'request') {
      ctx.reply(msg, { status: 'ok', code: 202 })
      ctx.label('202', 'ok')
      publish(ctx, ctx.newMessage('event', { ...msg.meta, eventType: msg.meta.eventType ?? msg.meta.path }, msg))
    } else {
      publish(ctx, msg)
    }
  },
  /**
   * A subscriber pulled: hand it the oldest event from its own lane, if any. The poller is the last
   * node on the poll's trail. A poll from a node that is not a current output (or an empty lane)
   * hands over nothing and the subscriber re-polls on its own interval.
   */
  onPoll(poll, ctx) {
    const sub = poll.trail[poll.trail.length - 1]
    if (sub === undefined) return
    const isSubscriber = ctx.outputs().some((o) => o.target === sub && o.targetType !== 'queue')
    const lane = ctx.state.lanes[sub]
    // Hand over one event only if the lane has any and the subscriber is up with a free slot.
    if (!isSubscriber || !lane || lane.length === 0 || !isFree(ctx, sub, ctx.state.inFlight)) return
    const next = lane.shift()!
    ctx.state.inFlight[sub] = (ctx.state.inFlight[sub] ?? 0) + 1
    ctx.state.pending[next.id] = sub
    ctx.state.delivered[sub] = (ctx.state.delivered[sub] ?? 0) + 1
    ctx.send(sub, next)
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
    const acks = (ctx.state.acks[target] ??= { ok: 0, errors: 0 })
    if (res.status === 'ok') acks.ok++
    else acks.errors++
  },
})
