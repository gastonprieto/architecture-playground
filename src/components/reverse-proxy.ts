import { defineComponent } from '../engine/registry'
import { matchesPath } from '../engine/rules'
import type { Message } from '../engine/types'

/** Who the proxy lets through (sessions spec §8). */
export type ProxyAuth = 'none' | 'credentials' | 'jwt'

export interface ReverseProxyConfig {
  name: string
  auth: ProxyAuth
  rateLimit: number
  cacheHitRate: number
}

export interface ReverseProxyState {
  /** Arrival times (sim ms) of accepted requests inside the rate-limit window. */
  window: number[]
  /** JWT mode: forwarded request ids whose response must carry a new token. */
  issue: Record<string, true>
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

export const reverseProxy = defineComponent<ReverseProxyConfig, ReverseProxyState>({
  type: 'reverse-proxy',
  label: 'Reverse Proxy',
  icon: '🚪',
  color: 'req',
  config: {
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
    cacheHitRate: { type: 'number', label: 'Cache hit', default: 0, min: 0, max: 1, step: 0.05 },
  },
  initialState: () => ({ window: [], issue: {} }),
  onMessage(msg, ctx) {
    const { rateLimit, cacheHitRate } = ctx.config
    ctx.state.issue ??= {}

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

    // 3. Cache hit: auth already passed, so a login answered from the cache gets its token too.
    if (cacheHitRate > 0 && ctx.random() < cacheHitRate) {
      ctx.label('HIT', 'redis')
      ctx.reply(msg, { status: 'ok', code: 200, meta: token ? { setSession: token } : undefined })
      return
    }

    // 4. Route: longest matching prefix wins, ties go to the first edge.
    const path = msg.meta.path ?? '/'
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
    ctx.send(best.target, msg)
  },
  onResponse(res, ctx) {
    ctx.state.issue ??= {}
    const id = res.replyTo
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
