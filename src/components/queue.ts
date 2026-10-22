import { defineComponent, type Ctx } from '../engine/registry'
import type { Message, NodeId } from '../engine/types'
import { pushReady, release } from './shared/push'

export interface QueueConfig {
  name: string
  queueMax: number
  maxRetries: number
}

export interface QueueState {
  /** Messages waiting for a free worker, oldest first (the UI draws them as cells). */
  items: Message[]
  /** Messages sent to a worker and not acked yet: message id → worker and the message itself. */
  pending: Record<string, { worker: NodeId; msg: Message }>
  /** Messages in flight per worker. */
  inFlight: Record<NodeId, number>
  /** Round-robin cursor into the worker list. */
  next: number
}

type QueueCtx = Ctx<QueueConfig, QueueState>

/** Adds a message at the back (fresh trail: the queue is where its delivery starts), then pumps. */
function enqueue(ctx: QueueCtx, msg: Message): void {
  ctx.state.items.push({ ...msg, trail: [], attempt: msg.attempt ?? 0 })
  pump(ctx)
}

/** Pushes waiting messages to free workers (every output that is not a DLQ), round-robin. */
function pump(ctx: QueueCtx): void {
  const st = ctx.state
  if (st.items.length === 0) return
  const workers = ctx.outputs().filter((o) => o.targetType !== 'dlq').map((o) => o.target)
  if (workers.length === 0) return
  const buffers = Object.fromEntries(workers.map((w) => [w, st.items]))
  const pushed = pushReady(ctx, buffers, st.inFlight, workers, st.next % workers.length)
  for (const p of pushed) st.pending[p.msg.id] = { worker: p.target, msg: p.msg }
  if (pushed.length > 0) st.next = (workers.indexOf(pushed[pushed.length - 1].target) + 1) % workers.length
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
  config: {
    queueMax: { type: 'number', label: 'Cola máx.', default: 50, min: 0, max: 500 },
    maxRetries: { type: 'number', label: 'Reintentos máx.', default: 3, min: 0, max: 10 },
  },
  initialState: () => ({ items: [], pending: {}, inFlight: {}, next: 0 }),
  onMessage(msg, ctx) {
    if (ctx.state.items.length >= ctx.config.queueMax) {
      // Requests get a 503 back; messages and events are just dropped.
      ctx.drop(msg, 'queue-full', 503)
      return
    }
    if (msg.kind === 'request') {
      // Pull model: the queue acknowledges the enqueue (so the producer's round trip and metrics
      // still close) but shows no 202 badge; a worker only gets the message when it pulls.
      ctx.reply(msg, { status: 'ok', code: 202 })
      enqueue(ctx, { ...ctx.newMessage('message', msg.meta, msg), attempt: 0 })
    } else {
      enqueue(ctx, msg)
    }
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
        ctx.label('retry', 'slow')
        ctx.state.items.push({ ...entry.msg, trail: [], attempt: attempt + 1 })
      } else {
        deadLetter(ctx, { ...entry.msg, trail: [] })
      }
    }
    pump(ctx)
  },
  // Picks up workers that came back up or got more capacity through a config change.
  onTick(ctx) {
    pump(ctx)
  },
})
