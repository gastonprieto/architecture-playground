import type { Ctx } from '../../engine/registry'

/** State a pull consumer (Worker, Suscriptor) holds to space out its polling. */
export interface PullState {
  /** Sim-ms accumulated since the last idle poll (see pollTick). */
  pollAcc: number
}

export const initialPullState = (): PullState => ({ pollAcc: Infinity })

/** Upstreams worth polling: the queues and brokers wired into this consumer. */
function upstreams(ctx: Ctx): string[] {
  return ctx.inputs().filter((i) => i.sourceType === 'queue' || i.sourceType === 'broker').map((i) => i.source)
}

/**
 * Pull work for every free slot: one poll per free slot, spread round-robin over the upstream
 * queues/brokers. A poll that finds nothing waiting is harmless (the upstream hands over nothing).
 * Does nothing when the node is full or has no upstream queue/broker.
 */
export function pullUpstreams(ctx: Ctx): void {
  const sources = upstreams(ctx)
  if (sources.length === 0) return
  const free = ctx.freeSlots()
  for (let i = 0; i < free; i++) ctx.pull(sources[i % sources.length])
}

/**
 * Idle polling: every `intervalMs` of sim time, poll again for work. Consumers call this from
 * onTick; it also pulls right away the first time it is called after a reset. A consumer that just
 * freed a slot should call `pullUpstreams` directly for a prompt pull, without waiting the interval.
 */
export function pollTick<C>(ctx: Ctx<C, PullState>, dtMs: number, fallbackMs: number): void {
  const configured = (ctx.config as { pollInterval?: unknown }).pollInterval
  const interval = typeof configured === 'number' && configured > 0 ? configured : fallbackMs
  ctx.state.pollAcc = (ctx.state.pollAcc ?? 0) + dtMs
  if (ctx.state.pollAcc < interval) return
  ctx.state.pollAcc = 0
  pullUpstreams(ctx)
}
