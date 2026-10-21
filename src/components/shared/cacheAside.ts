import type { Ctx, OutEdge } from '../../engine/registry'
import type { Message, NodeId } from '../../engine/types'
import { cacheKeyOf } from '../cache'
import { callDependencies, type DependencyMode, type DependencyState } from './dependencies'

/*
 * Cache-aside from the caller's side (docs/cache-spec.md §3): `get` the key from a leaf Cache; on a
 * miss call the other dependencies and, if they all answered ok, `set` the key. A failing cache
 * never fails the request: it counts as a miss without set.
 */

/** State a component must hold to use cacheAside. */
export interface CacheAsideState {
  /** Cache request id → the Cache it went to and what to do with its response (absent: the Cache vanished). */
  cachePending: Record<string, { target: NodeId; next: (res?: Message) => void }>
}

export const initialCacheAsideState = (): CacheAsideState => ({ cachePending: {} })

type CacheAsideCtx = Ctx<unknown, CacheAsideState & DependencyState>

/** Outputs to a Cache with no outputs of its own (a leaf, not read-through), in output order, one per node. */
export function leafCaches(ctx: Ctx): OutEdge[] {
  const seen = new Set<NodeId>()
  return ctx.outputs().filter((o) => {
    if (o.targetType !== 'cache' || seen.has(o.target) || ctx.peerOutputCount(o.target) > 0) return false
    seen.add(o.target)
    return true
  })
}

/**
 * The meta of a cache request made for `parent`: who it is for (identity and color, to paint the
 * packet), its path, the operation and the key. Nothing else (no credentials or cookies).
 */
export function cacheOpMeta(parent: Message, op: 'get' | 'set', key: string): Message['meta'] {
  const meta: Message['meta'] = { cacheOp: op, cacheKey: key }
  for (const k of ['clientId', 'clientName', 'clientColor', 'path'] as const) if (parent.meta[k] !== undefined) meta[k] = parent.meta[k]
  return meta
}

function sendCacheOp(ctx: CacheAsideCtx, parent: Message, target: NodeId, op: 'get' | 'set', key: string, next: (res?: Message) => void): void {
  const child = ctx.newMessage('request', cacheOpMeta(parent, op, key), parent)
  ctx.state.cachePending[child.id] = { target, next }
  ctx.send(target, child)
}

/**
 * Handles `msg` cache-aside when the node has a leaf Cache (the first one is used) and returns true;
 * returns false (doing nothing) otherwise. `done(ok)`: true on a HIT, or on a MISS whose other
 * dependencies (called with `mode`) all answered ok; false when one of them failed (nothing is set).
 * Responses must be routed through `handleCacheAsideResponse` before `handleDependencyResponse`.
 */
export function cacheAside(ctx: CacheAsideCtx, msg: Message, mode: DependencyMode, done: (ok: boolean) => void): boolean {
  const caches = leafCaches(ctx)
  if (caches.length === 0) return false
  ctx.state.cachePending ??= {}
  const cache = caches[0].target
  const leafIds = new Set(caches.map((c) => c.target))
  const key = cacheKeyOf(msg.meta)
  sendCacheOp(ctx, msg, cache, 'get', key, (res) => {
    if (res?.status === 'ok') {
      done(true)
      return
    }
    // 404 is a real MISS; anything else (down, queue full, gone) is a failed cache: go on, never set.
    const miss = res?.code === 404
    const others = ctx.outputs().filter((o) => !leafIds.has(o.target))
    callDependencies(ctx, msg, mode, (ok) => {
      if (!ok || !miss) done(ok)
      // The set's own outcome does not matter: the data is already there.
      else sendCacheOp(ctx, msg, cache, 'set', key, () => done(true))
    }, others)
  })
  return true
}

/** If `res` answers a cache request sent by cacheAside, consumes it and returns true. */
export function handleCacheAsideResponse(res: Message, ctx: Ctx<unknown, CacheAsideState>): boolean {
  const pending = ctx.state.cachePending
  const entry = res.replyTo === undefined || !pending ? undefined : pending[res.replyTo]
  if (!entry) return false
  delete pending[res.replyTo!]
  entry.next(res)
  return true
}

/** Settles cache requests whose Cache was deleted (their response never comes) as failed. */
export function sweepCacheAsidePending(ctx: Ctx<unknown, CacheAsideState>): void {
  const pending = ctx.state.cachePending
  if (!pending) return
  for (const id of Object.keys(pending)) {
    const entry = pending[id]
    if (!entry || ctx.peer(entry.target)) continue
    delete pending[id]
    entry.next()
  }
}
