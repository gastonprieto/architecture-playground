import { defineComponent, processingFields, type Ctx, type Field } from '../engine/registry'
import type { Message } from '../engine/types'

/*
 * Cache (docs/cache-spec.md §2). Without outputs it is a leaf for cache-aside: it answers `get`
 * (200 with `meta.cacheHit` true/false: a MISS is not an error) and `set`. With outputs it is read-through: a HIT answers
 * here, a MISS goes to the first output and an ok response stores the key on its way back.
 * `keys` mode keeps real keys (LRU + TTL in sim time); `random` mode hits with probability hitRate.
 */

export type CacheMode = 'keys' | 'random'

export interface CacheConfig {
  name: string
  mode: CacheMode
  /** Keys mode: how many keys fit (LRU eviction). Not a concurrency limit. */
  capacity: number
  /** Keys mode: ms a key lives after it was stored; 0 = forever. */
  ttl: number
  /** Random mode: probability of a HIT. */
  hitRate: number
  processingTime: number
  up: boolean
}

/** A stored key and when it was stored (TTL). Recency is the position in the array. */
export interface CacheEntry {
  key: string
  at: number
}

export interface CacheState {
  /** Keys mode: stored keys, least recently used first. */
  keys: CacheEntry[]
  /** Lookups (get) answered HIT / MISS since the last reset. */
  hits: number
  misses: number
}

/** The key of a cache request: `cacheKey`, else `path`, else '/'. */
export function cacheKeyOf(meta: Message['meta']): string {
  if (typeof meta.cacheKey === 'string' && meta.cacheKey !== '') return meta.cacheKey
  if (typeof meta.path === 'string' && meta.path !== '') return meta.path
  return '/'
}

/** Drops every key stored `ttl` ms ago or earlier (ttl 0 = keys never expire). */
export function cachePurgeExpired(entries: CacheEntry[], now: number, ttl: number): void {
  if (!(ttl > 0)) return
  for (let i = entries.length - 1; i >= 0; i--) if (now - entries[i].at >= ttl) entries.splice(i, 1)
}

/** Drops least recently used keys until at most `capacity` remain. */
export function cacheTrim(entries: CacheEntry[], capacity: number): void {
  const max = Math.max(0, Math.floor(capacity))
  if (entries.length > max) entries.splice(0, entries.length - max)
}

/**
 * Looks `key` up at `now`: expired keys are removed first (they count as a miss). A hit moves the
 * key to the most recently used end. Mutates `entries` (kept least recently used first).
 */
export function cacheLookup(entries: CacheEntry[], key: string, now: number, ttl: number): boolean {
  cachePurgeExpired(entries, now, ttl)
  const i = entries.findIndex((e) => e.key === key)
  if (i === -1) return false
  entries.push(...entries.splice(i, 1))
  return true
}

/** Stores (or refreshes) `key` at `now` as the most recently used, evicting LRU keys beyond `capacity`. */
export function cacheStore(entries: CacheEntry[], key: string, now: number, capacity: number, ttl: number): void {
  cachePurgeExpired(entries, now, ttl)
  const i = entries.findIndex((e) => e.key === key)
  if (i !== -1) entries.splice(i, 1)
  entries.push({ key, at: now })
  cacheTrim(entries, capacity)
}

/** Same field as processingFields.processingTime, with a fast default (an in-memory lookup). */
const baseTime = processingFields.processingTime
const processingTime: Field = baseTime.type === 'number' ? { ...baseTime, default: 50 } : baseTime

const KEYS = { field: 'mode', equals: 'keys' } as const

type CacheCtx = Ctx<CacheConfig, CacheState>

/** Whether `key` is a HIT now (keys: stored and fresh; random: hitRate). Counts hits and misses. */
function lookup(ctx: CacheCtx, key: string): boolean {
  const { config, state } = ctx
  const hit = config.mode === 'random' ? ctx.random() < config.hitRate : cacheLookup(state.keys, key, ctx.now, config.ttl)
  if (hit) state.hits++
  else state.misses++
  return hit
}

function store(ctx: CacheCtx, key: string): void {
  if (ctx.config.mode === 'random') return
  cacheStore(ctx.state.keys, key, ctx.now, ctx.config.capacity, ctx.config.ttl)
}

export const cache = defineComponent<CacheConfig, CacheState>({
  type: 'cache',
  label: 'Cache',
  icon: '⚡',
  color: 'redis',
  config: {
    mode: {
      type: 'select',
      label: 'Modo',
      default: 'keys',
      options: [
        { value: 'keys', label: 'Claves reales' },
        { value: 'random', label: 'Aleatorio' },
      ],
    },
    capacity: { type: 'number', label: 'Capacidad', default: 50, min: 1, max: 1000, showIf: KEYS },
    ttl: { type: 'number', label: 'TTL', default: 0, min: 0, max: 600000, step: 100, unit: 'ms', showIf: KEYS },
    hitRate: { type: 'number', label: 'Hit rate', default: 0.8, min: 0, max: 1, step: 0.05, showIf: { field: 'mode', equals: 'random' } },
    processingTime,
    up: processingFields.up,
  },
  // `capacity` counts keys: the lookup itself has unlimited slots and no queue, so it never queues or rejects (only when down).
  processingConfig: (c) => ({ up: c.up, processingTime: c.processingTime }),
  initialState: () => ({ keys: [], hits: 0, misses: 0 }),
  onConfig(ctx) {
    ctx.state.keys ??= []
    if (ctx.config.mode === 'random') ctx.state.keys.length = 0
    else cacheTrim(ctx.state.keys, ctx.config.capacity)
  },
  onMessage(msg, ctx) {
    ctx.process(msg, () => {
      const key = cacheKeyOf(msg.meta)
      if (msg.meta.cacheOp === 'set') {
        store(ctx, key)
        ctx.reply(msg, { status: 'ok', code: 200 })
        return
      }
      if (lookup(ctx, key)) {
        ctx.label('HIT', 'redis')
        ctx.reply(msg, { status: 'ok', code: 200, meta: { cacheHit: true } })
        return
      }
      ctx.label('MISS', 'slow')
      const next = ctx.outputs()[0]
      if (!next) {
        ctx.reply(msg, { status: 'ok', code: 200, meta: { cacheHit: false } })
        return
      }
      // Downstream gets a plain request: the cache operation ends here.
      const { cacheOp: _op, ...meta } = msg.meta
      ctx.send(next.target, { ...msg, meta })
    })
  },
  /** Read-through: an ok response stores its key; every response goes back marked as a miss. */
  onResponse(res, ctx) {
    if (res.status === 'ok') store(ctx, cacheKeyOf(res.meta))
    ctx.forwardResponse({ ...res, meta: { ...res.meta, cacheHit: false } })
  },
})
