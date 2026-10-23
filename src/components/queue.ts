import { defineComponent, type Ctx } from '../engine/registry'
import type { Message, NodeId } from '../engine/types'
import { isFree, release } from './shared/push'

export interface QueueConfig {
  name: string
  queueMax: number
  maxRetries: number
}

export interface QueueState {
  /** Messages waiting for a worker to pull them, oldest first (the UI draws them as cells). */
  items: Message[]
  /** Messages handed to a worker and not acked yet: message id → worker and the message itself. */
  pending: Record<string, { worker: NodeId; msg: Message }>
  /** Messages in flight per worker. */
  inFlight: Record<NodeId, number>
}

type QueueCtx = Ctx<QueueConfig, QueueState>

/** Adds a message at the back (fresh trail: the queue is where its delivery starts). No push: a worker pulls it. */
function enqueue(ctx: QueueCtx, msg: Message): void {
  ctx.state.items.push({ ...msg, trail: [], attempt: msg.attempt ?? 0 })
}

/** A message failed for good: to the first DLQ output, or dropped. */
function deadLetter(ctx: QueueCtx, msg: Message): void {
  const dlq = ctx.outputs().find((o) => o.targetType === 'dlq')
  if (dlq) {
    ctx.label('DLQ', 'err')
    ctx.send(dlq.target, msg)
  } else {
    ctx.drop(msg, 'no-dlq')
  }
}

export const queue = defineComponent<QueueConfig, QueueState>({
  type: 'queue',
  label: 'Cola',
  icon: '📬',
  color: 'req',
  group: 'messaging',
  config: {
    queueMax: { type: 'number', label: 'Cola máx.', default: 50, min: 0, max: 500 },
    maxRetries: { type: 'number', label: 'Reintentos máx.', default: 3, min: 0, max: 10 },
  },
  initialState: () => ({ items: [], pending: {}, inFlight: {} }),
  onMessage(msg, ctx) {
    if (ctx.state.items.length >= ctx.config.queueMax) {
      // Requests get a 503 back; messages and events are just dropped.
      ctx.drop(msg, 'queue-full', 503)
      return
    }
    if (msg.kind === 'request') {
      // The queue acks the enqueue so the producer's round trip and metrics close; no 202 badge, and
      // the worker only gets the message when it pulls (see onPoll).
      ctx.reply(msg, { status: 'ok', code: 202 })
      enqueue(ctx, { ...ctx.newMessage('message', msg.meta, msg), attempt: 0 })
    } else {
      enqueue(ctx, msg)
    }
  },
  /**
   * A worker pulled: hand it the oldest waiting message, if any. The poller is the last node on the
   * poll's trail (it appended itself on the way here). A poll to a DLQ output, or with nothing
   * waiting, hands over nothing and the worker re-polls on its own interval.
   */
  onPoll(poll, ctx) {
    const worker = poll.trail[poll.trail.length - 1]
    if (worker === undefined) return
    const isWorker = ctx.outputs().some((o) => o.target === worker && o.targetType !== 'dlq')
    // Hand over one message only if there is work and the worker is up with a free slot (a burst of
    // polls can arrive before earlier deliveries land; this keeps in-flight within its capacity).
    if (!isWorker || ctx.state.items.length === 0 || !isFree(ctx, worker, ctx.state.inFlight)) return
    const next = ctx.state.items.shift()!
    ctx.state.inFlight[worker] = (ctx.state.inFlight[worker] ?? 0) + 1
    ctx.state.pending[next.id] = { worker, msg: next }
    ctx.send(worker, next)
  },
  onResponse(res, ctx) {
    const entry = res.replyTo === undefined ? undefined : ctx.state.pending[res.replyTo]
    if (!entry) {
      ctx.forwardResponse(res)
      return
    }
    delete ctx.state.pending[res.replyTo!]
    release(ctx.state.inFlight, entry.worker)
    if (res.status !== 'ok') {
      const attempt = entry.msg.attempt ?? 0
      if (attempt < ctx.config.maxRetries) {
        // Back into the queue for a worker to pull again (no push).
        ctx.label('retry', 'slow')
        ctx.state.items.push({ ...entry.msg, trail: [], attempt: attempt + 1 })
      } else {
        deadLetter(ctx, { ...entry.msg, trail: [] })
      }
    }
  },
})
