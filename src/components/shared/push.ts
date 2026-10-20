import type { Ctx } from '../../engine/registry'
import type { Message, NodeId } from '../../engine/types'

/** A message pushReady sent, and where it went. */
export interface Pushed {
  target: NodeId
  msg: Message
}

/** Concurrent slots a target accepts: its `capacity` config, or 1 when it has none. */
export function targetCapacity(ctx: Ctx, target: NodeId): number {
  const c = ctx.peer(target)?.config.capacity
  return typeof c === 'number' && c > 0 ? c : 1
}

/** True if `target` exists, is up and has a free slot according to `inFlight`. */
export function isFree(ctx: Ctx, target: NodeId, inFlight: Record<NodeId, number>): boolean {
  const peer = ctx.peer(target)
  if (!peer || peer.config.up === false) return false
  return (inFlight[target] ?? 0) < targetCapacity(ctx, target)
}

/**
 * Push-based delivery: sends buffered messages to every target in `targets` that is up and whose
 * `inFlight` count is below its `capacity` (default 1), shifting from `buffers[target]` and
 * incrementing `inFlight[target]` per send. Works in rounds (at most one message per target per
 * round), so when several targets share one buffer array the work is spread round-robin, starting at
 * `targets[start]`. Returns what was sent, in order; the caller decrements `inFlight` on ack/nack.
 *
 * - Per-target lanes (broker): `buffers = { S1: [...], S2: [...] }`.
 * - One shared queue (queue): every target maps to the same array.
 */
export function pushReady(
  ctx: Ctx,
  buffers: Record<NodeId, Message[]>,
  inFlight: Record<NodeId, number>,
  targets: NodeId[],
  start = 0,
): Pushed[] {
  const n = targets.length
  const order = n === 0 ? [] : targets.map((_, i) => targets[(start + i) % n])
  const pushed: Pushed[] = []
  let progress = true
  while (progress) {
    progress = false
    for (const target of order) {
      const buffer = buffers[target]
      if (!buffer || buffer.length === 0 || !isFree(ctx, target, inFlight)) continue
      const msg = buffer.shift()!
      inFlight[target] = (inFlight[target] ?? 0) + 1
      ctx.send(target, msg)
      pushed.push({ target, msg })
      progress = true
    }
  }
  return pushed
}

/** Frees one in-flight slot of `target` (on its ack/nack). */
export function release(inFlight: Record<NodeId, number>, target: NodeId): void {
  inFlight[target] = Math.max(0, (inFlight[target] ?? 0) - 1)
}
