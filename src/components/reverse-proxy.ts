import { defineComponent } from '../engine/registry'
import { matchesPath } from '../engine/rules'

export interface ReverseProxyConfig {
  name: string
  authFailRate: number
  rateLimit: number
  cacheHitRate: number
}

export interface ReverseProxyState {
  /** Arrival times (sim ms) of accepted requests inside the rate-limit window. */
  window: number[]
}

const WINDOW_MS = 1000

export const reverseProxy = defineComponent<ReverseProxyConfig, ReverseProxyState>({
  type: 'reverse-proxy',
  label: 'Reverse Proxy',
  icon: '🚪',
  color: 'req',
  config: {
    authFailRate: { type: 'number', label: 'Rechazo auth', default: 0, min: 0, max: 1, step: 0.05 },
    rateLimit: { type: 'number', label: 'Rate limit', default: 0, min: 0, max: 100, unit: 'req/s' },
    cacheHitRate: { type: 'number', label: 'Cache hit', default: 0, min: 0, max: 1, step: 0.05 },
  },
  initialState: () => ({ window: [] }),
  onMessage(msg, ctx) {
    const { authFailRate, rateLimit, cacheHitRate } = ctx.config

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

    // 2. Auth
    if (authFailRate > 0 && ctx.random() < authFailRate) {
      ctx.reply(msg, { status: 'error', code: 401 })
      return
    }

    // 3. Cache hit
    if (cacheHitRate > 0 && ctx.random() < cacheHitRate) {
      ctx.label('HIT', 'redis')
      ctx.reply(msg, { status: 'ok', code: 200 })
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
    ctx.send(best.target, msg)
  },
})
