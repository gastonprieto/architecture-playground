import { Registry, defineComponent, processingFields } from '../../src/engine/registry'
import type { Graph, GraphEdge, GraphNode } from '../../src/engine/types'

/** Replies ok 200 to every request. */
export const echo = defineComponent({
  type: 'echo',
  label: 'Echo',
  icon: 'e',
  color: 'ok',
  config: {},
  initialState: () => ({}),
  onMessage(msg, ctx) {
    if (msg.kind === 'request') ctx.reply(msg, { status: 'ok', code: 200 })
  },
})

/** Sends everything to its first output; no onResponse, so the engine forwards responses. */
export const fwd = defineComponent({
  type: 'fwd',
  label: 'Forward',
  icon: 'f',
  color: 'req',
  config: {},
  initialState: () => ({}),
  onMessage(msg, ctx) {
    const out = ctx.outputs()[0]
    if (out) ctx.send(out.target, msg)
    else ctx.drop(msg, 'sin salida')
  },
})

/** Processes (ctx.process) and then replies ok 200. */
export const slow = defineComponent({
  type: 'slow',
  label: 'Slow',
  icon: 's',
  color: 'slow',
  config: {
    processingTime: { type: 'number', label: 'Tiempo', default: 400, min: 0, max: 5000 },
  },
  initialState: () => ({}),
  onMessage(msg, ctx) {
    ctx.process(msg, () => ctx.reply(msg, { status: 'ok', code: 200 }))
  },
})

/** Processing component (up/processingTime/capacity/queueMax): processes, then replies ok 200. */
export const proc = defineComponent({
  type: 'proc',
  label: 'Proc',
  icon: 'p',
  color: 'slow',
  config: { ...processingFields },
  initialState: () => ({}),
  onMessage(msg, ctx) {
    ctx.process(msg, () => ctx.reply(msg, { status: 'ok', code: 200 }))
  },
})

/** Drops every message with code 429. */
export const reject = defineComponent({
  type: 'reject',
  label: 'Reject',
  icon: 'r',
  color: 'err',
  config: {},
  initialState: () => ({}),
  onMessage(msg, ctx) {
    ctx.drop(msg, 'rechazado', 429)
  },
})

/** On each tick, with probability 0.3, sends a new request to its first output. Records ticks and responses. */
export const gen = defineComponent({
  type: 'gen',
  label: 'Gen',
  icon: 'g',
  color: 'req',
  config: {},
  initialState: () => ({ ticks: [] as number[], responses: [] as { at: number; createdAt: number; code?: number }[] }),
  onMessage() {},
  onResponse(res, ctx) {
    ctx.state.responses.push({ at: ctx.now, createdAt: res.createdAt, code: res.code })
  },
  onTick(ctx, dtMs) {
    ctx.state.ticks.push(dtMs)
    const out = ctx.outputs()[0]
    if (out && ctx.random() < 0.3) ctx.send(out.target, ctx.newMessage('request', { path: '/x' }))
  },
})

/** Has a `bump` action that increments state.count and emits a label. */
export const counter = defineComponent({
  type: 'counter',
  label: 'Counter',
  icon: 'c',
  color: 'hc',
  config: {},
  initialState: () => ({ count: 0 }),
  onMessage() {},
  actions: {
    bump: {
      label: 'Bump',
      run(ctx) {
        ctx.state.count++
        ctx.label(`+${ctx.state.count}`, 'ok')
      },
    },
  },
})

export function makeRegistry(): Registry {
  const r = new Registry()
  for (const def of [echo, fwd, slow, proc, reject, gen, counter]) r.register(def)
  return r
}

export const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})

export const edge = (source: string, target: string, id = `${source}-${target}`): GraphEdge => ({ id, source, target })

export const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ nodes, edges })
