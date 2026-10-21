import type { Ctx, OutEdge } from '../../engine/registry'
import type { Message } from '../../engine/types'

export type DependencyMode = 'parallel' | 'sequential'

/** Bookkeeping for one parent message waiting on its dependencies. Shared by all its children. */
export interface DependencyCall {
  /** The message whose handling waits on the dependencies. */
  parent: Message
  mode: DependencyMode
  /** Sequential: outputs not called yet, in order. */
  remaining: OutEdge[]
  /** Children sent and not answered yet. */
  outstanding: number
  ok: boolean
  done: (ok: boolean) => void
}

/** State a component must hold to use callDependencies. */
export interface DependencyState {
  /** Child request id → the parent call it belongs to. */
  pending: Record<string, DependencyCall>
}

export const initialDependencyState = (): DependencyState => ({ pending: {} })

/**
 * Calls every dependency of this node for `msg`: a child request (same meta, parentId = msg.id) to
 * each output except DLQs (queues and brokers included: they answer 202). `parallel` sends all at
 * once and finishes when all answered; `sequential` sends one at a time and stops at the first
 * error. `done(ok)` gets ok only if every child answered ok. No outputs → `done(true)` synchronously.
 * `outputs` narrows the dependencies (default: every output of the node).
 *
 * The owning component must route responses through `handleDependencyResponse` in its onResponse.
 */
export function callDependencies(
  ctx: Ctx<unknown, DependencyState>,
  msg: Message,
  mode: DependencyMode,
  done: (ok: boolean) => void,
  outputs: OutEdge[] = ctx.outputs(),
): void {
  const targets = outputs.filter((o) => o.targetType !== 'dlq')
  if (targets.length === 0) {
    done(true)
    return
  }
  const call: DependencyCall = { parent: msg, mode, remaining: [], outstanding: 0, ok: true, done }
  if (mode === 'sequential') {
    call.remaining = targets.slice(1)
    callOne(ctx, call, targets[0])
  } else {
    for (const out of targets) callOne(ctx, call, out)
  }
}

/**
 * If `res` answers a child request sent by callDependencies, consumes it (updating the parent call
 * and possibly finishing it) and returns true. Otherwise returns false and leaves `res` alone.
 */
export function handleDependencyResponse(res: Message, ctx: Ctx<unknown, DependencyState>): boolean {
  const call = res.replyTo === undefined ? undefined : ctx.state.pending[res.replyTo]
  if (!call) return false
  delete ctx.state.pending[res.replyTo!]
  call.outstanding--
  if (res.status !== 'ok') call.ok = false

  if (call.mode === 'sequential') {
    const next = call.remaining.shift()
    if (call.ok && next) callOne(ctx, call, next)
    else call.done(call.ok)
  } else if (call.outstanding === 0) {
    call.done(call.ok)
  }
  return true
}

function callOne(ctx: Ctx<unknown, DependencyState>, call: DependencyCall, out: OutEdge): void {
  const child = ctx.newMessage('request', call.parent.meta, call.parent)
  ctx.state.pending[child.id] = call
  call.outstanding++
  ctx.send(out.target, child)
}
