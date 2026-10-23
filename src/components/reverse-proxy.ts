import { defineComponent, processingFields, type Ctx } from '../engine/registry'
import { matchesPath } from '../engine/rules'
import type { Message } from '../engine/types'
import { cacheLookup, cacheStore, cacheTrim, type CacheEntry } from './cache'

/** Who the proxy lets through (sessions spec §8). */
export type ProxyAuth = 'none' | 'credentials' | 'jwt'

/** The edge cache (cache-spec §5): off, random hits, or real keys (same LRU/TTL as the Cache). */
export type ProxyCache = 'off' | 'random' | 'keys'

export interface ReverseProxyConfig {
  name: string
  up: boolean
  auth: ProxyAuth
  rateLimit: number
  cache: ProxyCache
  /** Random cache: probability of a HIT. */
  hitRate: number
  /** Keys cache: how many keys fit (LRU eviction). */
  capacity: number
  /** Keys cache: ms a key lives after it was stored; 0 = forever. */
  ttl: number
  /** Path prefixes that go through the cache; empty = every path. */
  cacheablePaths: string[]
}

export interface ReverseProxyState {
  /** Arrival times (sim ms) of accepted requests inside the rate-limit window. */
  window: number[]
  /** JWT mode: forwarded request ids whose response must carry a new token. */
  issue: Record<string, true>
  /** Keys cache: forwarded request id → the key to store when its ok response passes back. */
  store: Record<string, string>
  /** Keys cache: stored keys, least recently used first. */
  keys: CacheEntry[]
  /** Cache lookups answered HIT / MISS since the last reset. */
  hits: number
  misses: number
}

const WINDOW_MS = 1000

/**
 * What the proxy does with a request in auth `mode`: `reject` (401 unauthenticated), `pass`, or
 * `issue` (pass and hand out a JWT on the way back). A `sid:` cookie is not a token in JWT mode.
 * An unknown mode lets everything through, like `none`.
 */
export function proxyAuthDecision(mode: ProxyAuth, meta: Message['meta']): 'reject' | 'pass' | 'issue' {
  const sessionId = typeof meta.sessionId === 'string' && meta.sessionId !== '' ? meta.sessionId : undefined
  const credentials = meta.credentials === true
  if (mode === 'credentials') return credentials || sessionId !== undefined ? 'pass' : 'reject'
  if (mode === 'jwt') {
    if (sessionId?.startsWith('jwt:')) return 'pass'
    return credentials ? 'issue' : 'reject'
  }
  return 'pass'
}

/** Whether `path` goes through the edge cache: it starts with a listed prefix (blank entries ignored; none = every path). */
export function isCacheable(path: string, prefixes: readonly string[] | undefined): boolean {
  const list = (prefixes ?? []).filter((p) => typeof p === 'string' && p.trim() !== '')
  return list.length === 0 || list.some((p) => path.startsWith(p.trim()))
}

type ProxyCtx = Ctx<ReverseProxyConfig, ReverseProxyState>

/** Older states (and ones from before the edge cache) lack some maps: fill them in. */
function ensureState(state: ReverseProxyState): void {
  state.issue ??= {}
  state.store ??= {}
  state.keys ??= []
  state.hits ??= 0
  state.misses ??= 0
}

/** Edge cache lookup for a cacheable request: true on a HIT. Counts hits and misses. */
function edgeLookup(ctx: ProxyCtx, key: string): boolean {
  const { config, state } = ctx
  const hit = config.cache === 'random' ? ctx.random() < config.hitRate : cacheLookup(state.keys, key, ctx.now, config.ttl)
  if (hit) state.hits++
  else state.misses++
  return hit
}

const CACHE_ON = { field: 'cache', notEquals: 'off' } as const
const CACHE_KEYS = { field: 'cache', equals: 'keys' } as const

export const reverseProxy = defineComponent<ReverseProxyConfig, ReverseProxyState>({
  type: 'reverse-proxy',
  label: 'Reverse Proxy',
  icon: '🚪',
  color: 'req',
  group: 'edge',
  config: {
    up: processingFields.up,
    auth: {
      type: 'select',
      label: 'Autenticación',
      default: 'none',
      options: [
        { value: 'none', label: 'Ninguna' },
        { value: 'credentials', label: 'Credenciales' },
        { value: 'jwt', label: 'JWT' },
      ],
    },
    rateLimit: { type: 'number', label: 'Rate limit', default: 0, min: 0, max: 100, unit: 'req/s' },
    cache: {
      type: 'select',
      label: 'Cache',
      default: 'off',
      options: [
        { value: 'off', label: 'Apagada' },
        { value: 'random', label: 'Aleatoria' },
        { value: 'keys', label: 'Claves reales' },
      ],
    },
    hitRate: { type: 'number', label: 'Hit rate', default: 0.8, min: 0, max: 1, step: 0.05, showIf: { field: 'cache', equals: 'random' } },
    capacity: { type: 'number', label: 'Capacidad', default: 50, min: 1, max: 1000, showIf: CACHE_KEYS },
    ttl: { type: 'number', label: 'TTL', default: 0, min: 0, max: 600000, step: 100, unit: 'ms', showIf: CACHE_KEYS },
    cacheablePaths: { type: 'list', label: 'Paths cacheables', default: ['/static'], showIf: CACHE_ON },
  },
  initialState: () => ({ window: [], issue: {}, store: {}, keys: [], hits: 0, misses: 0 }),
  onConfig(ctx, prev) {
    ensureState(ctx.state)
    // A new cache mode starts its hit % from scratch.
    if (prev && (prev.cache ?? 'off') !== (ctx.config.cache ?? 'off')) {
      ctx.state.hits = 0
      ctx.state.misses = 0
    }
    if (ctx.config.cache !== 'keys') ctx.state.keys.length = 0
    else {
      // Keys whose path is no longer cacheable would never be looked up again: drop them.
      ctx.state.keys = ctx.state.keys.filter((e) => isCacheable(e.key, ctx.config.cacheablePaths))
      cacheTrim(ctx.state.keys, ctx.config.capacity)
    }
  },
  onMessage(msg, ctx) {
    const { rateLimit } = ctx.config
    ensureState(ctx.state)

    // 1. Rate limit: sliding window; rejected requests do not count.
    if (rateLimit > 0) {
      const win = ctx.state.window
      while (win.length > 0 && win[0] <= ctx.now - WINDOW_MS) win.shift()
      if (win.length >= rateLimit) {
        ctx.reply(msg, { status: 'error', code: 429 })
        return
      }
      win.push(ctx.now)
    }

    // 2. Auth: only requests carry credentials or a cookie, so events and messages are not checked.
    const decision = msg.kind === 'request' ? proxyAuthDecision(ctx.config.auth, msg.meta) : 'pass'
    if (decision === 'reject') {
      ctx.reply(msg, { status: 'error', code: 401, meta: { authError: 'unauthenticated' } })
      return
    }
    const token = decision === 'issue' ? `jwt:${msg.id}` : undefined

    // 3. Edge cache (requests on a cacheable path only). Auth already passed, so a login answered
    //    from the cache gets its token too. The key is the path.
    const path = msg.meta.path ?? '/'
    const cacheMode = ctx.config.cache
    const cached = msg.kind === 'request' && (cacheMode === 'random' || cacheMode === 'keys') && isCacheable(path, ctx.config.cacheablePaths)
    if (cached && edgeLookup(ctx, path)) {
      ctx.label('HIT', 'redis')
      ctx.reply(msg, { status: 'ok', code: 200, meta: token ? { setSession: token, cacheHit: true } : { cacheHit: true } })
      return
    }

    // 4. Route: longest matching prefix wins, ties go to the first edge.
    let best: { target: string; len: number } | undefined
    for (const out of ctx.outputs()) {
      const len = matchesPath(out.rule, path)
      if (len >= 0 && (!best || len > best.len)) best = { target: out.target, len }
    }
    if (!best) {
      ctx.reply(msg, { status: 'error', code: 404 })
      return
    }
    if (token) ctx.state.issue[msg.id] = true
    if (cached && cacheMode === 'keys') ctx.state.store[msg.id] = path
    ctx.send(best.target, msg)
  },
  onResponse(res, ctx) {
    ensureState(ctx.state)
    const id = res.replyTo
    // Keys cache: an ok response stores the key of the request it answers.
    if (id !== undefined && id in ctx.state.store) {
      const key = ctx.state.store[id]
      delete ctx.state.store[id]
      if (res.status === 'ok' && ctx.config.cache === 'keys') cacheStore(ctx.state.keys, key, ctx.now, ctx.config.capacity, ctx.config.ttl)
    }
    if (id === undefined || !ctx.state.issue[id]) {
      ctx.forwardResponse(res)
      return
    }
    delete ctx.state.issue[id]
    // JWT issuance: the token is added to a fresh meta, so earlier hops never see it. A 401 carries none.
    if (res.code === 401) ctx.forwardResponse(res)
    else ctx.forwardResponse({ ...res, meta: { ...res.meta, setSession: `jwt:${id}` } })
  },
})
