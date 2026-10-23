import { defineComponent, type Ctx } from '../engine/registry'

export type MixEntry = { value: string; weight: number }

export interface ClientConfig {
  name: string
  /** Source IP the load balancer's ip-hash uses; empty → it hashes the client id. */
  ip: string
  /** Color of this client's packets (and of everything derived from them). */
  color: string
  kind: 'request' | 'event'
  rate: number
  mix: MixEntry[]
  burstSize: number
  /** How many users share this client (1..50); messages go round robin over them. */
  users: number
  /** 'login': requests carry credentials and the user's cookie; 'none': never. */
  auth: ClientAuth
}

export type ClientAuth = 'login' | 'none'

export interface ClientState {
  /** Fractional messages owed by onTick (rate * elapsed), sent once they reach whole units. */
  acc: number
  /** Round-robin cursor over the users. */
  next: number
  /** Session cookie of each user (index = userIndex); null = not logged in. Length = users. */
  cookies: (string | null)[]
}

/** The configured number of users, as an integer ≥ 1. */
export function userCount(config: Pick<ClientConfig, 'users'>): number {
  const n = Math.floor(Number(config.users))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Keep one cookie slot per user: new users start without a cookie, removed users are dropped. */
function syncUsers(ctx: Ctx<ClientConfig, ClientState>): void {
  const st = ctx.state
  const n = userCount(ctx.config)
  if (st.cookies.length > n) st.cookies.length = n
  while (st.cookies.length < n) st.cookies.push(null)
  if (st.next >= n) st.next = 0
}

/**
 * Per-client colors: six hue families (blue, amber, pink, lavender, peach, fuchsia), each clear
 * (CIE76 ΔE > 28) of the others and of every semantic tone (req, ok, slow, err, hc, redis, db,
 * text), so a client's packets never read as ok/error, a retry, a node tone or plain text.
 */
export const CLIENT_COLORS = ['#3b82f6', '#d97706', '#ec4899', '#c4b5fd', '#fdba74', '#d946ef'] as const

/** Burst messages are spread evenly over this many sim-ms. */
export const BURST_WINDOW_MS = 1000

/** Weighted pick from the mix; falls back to '/' for an empty or zero-weight mix. */
function pick(mix: MixEntry[], r: number): string {
  const total = mix.reduce((sum, e) => sum + Math.max(0, e.weight), 0)
  if (total <= 0) return '/'
  let x = r * total
  for (const e of mix) {
    x -= Math.max(0, e.weight)
    if (x < 0) return e.value
  }
  return mix[mix.length - 1].value
}

/** Sends one request (or event) to the first output, or drops it with 'no-output'. */
function sendOne(ctx: Ctx<ClientConfig, ClientState>): void {
  syncUsers(ctx)
  const value = pick(ctx.config.mix, ctx.random())
  const isEvent = ctx.config.kind === 'event'
  const users = userCount(ctx.config)
  const k = ctx.state.next
  ctx.state.next = (k + 1) % users
  const ip = ctx.config.ip ?? ''
  const cookie = ctx.state.cookies[k]
  // Only requests get answered, so only they carry credentials and cookies.
  const login = !isEvent && ctx.config.auth !== 'none'
  const who = {
    clientId: ctx.nodeId,
    // Each user is its own identity for the LB's IP Hash.
    // An empty IP falls back to the client id, so users of different clients never collide.
    clientIp: users > 1 ? `${ip || ctx.nodeId}#${k + 1}` : ip,
    clientName: ctx.config.name ?? '',
    ...(ctx.config.color ? { clientColor: ctx.config.color } : {}),
    userIndex: k,
    ...(login ? { credentials: true, ...(cookie ? { sessionId: cookie } : {}) } : {}),
  }
  const msg = ctx.newMessage(isEvent ? 'event' : 'request', isEvent ? { eventType: value, ...who } : { path: value, ...who })
  const out = ctx.outputs()[0]
  if (out) ctx.send(out.target, msg)
  else ctx.drop(msg, 'no-output')
}

export const client = defineComponent<ClientConfig, ClientState>({
  type: 'client',
  label: 'Cliente',
  icon: '💻',
  color: 'req',
  group: 'edge',
  recordsMetrics: true,
  inputs: false,
  config: {
    ip: { type: 'text', label: 'IP', default: '' },
    color: { type: 'color', label: 'Color', default: CLIENT_COLORS[0], options: CLIENT_COLORS },
    kind: {
      type: 'select',
      label: 'Tipo',
      default: 'request',
      options: [
        { value: 'request', label: 'Request' },
        { value: 'event', label: 'Evento' },
      ],
    },
    rate: { type: 'number', label: 'Tasa', default: 0, min: 0, max: 50, step: 1, unit: 'req/s' },
    mix: { type: 'mix', label: 'Mix (path / evento)', default: [{ value: '/', weight: 1 }] },
    burstSize: { type: 'number', label: 'Tamaño de ráfaga', default: 20, min: 1, max: 200, step: 1 },
    users: { type: 'number', label: 'Usuarios', default: 1, min: 1, max: 50, step: 1 },
    auth: {
      type: 'select',
      label: 'Autenticación',
      default: 'login',
      options: [
        { value: 'login', label: 'Con login' },
        { value: 'none', label: 'Sin credenciales' },
      ],
    },
  },
  initialState: () => ({ acc: 0, next: 0, cookies: [] }),
  // A client has no inputs: anything but a response that reaches it fails visibly (requests get a
  // 503 back). Responses never get here; they end at the client (empty trail).
  onMessage(msg, ctx) {
    ctx.drop(msg, 'client-rejects-requests', 503)
  },
  // Responses end here (the client originated them, so their trail is empty).
  onResponse(res, ctx) {
    if (res.trail.length > 0) {
      ctx.forwardResponse(res)
      return
    }
    syncUsers(ctx)
    const k = res.meta.userIndex
    // A response for a user removed meanwhile (users lowered) has nobody to store the cookie on.
    if (typeof k !== 'number' || k < 0 || k >= ctx.state.cookies.length) return
    if (typeof res.meta.setSession === 'string') ctx.state.cookies[k] = res.meta.setSession
    // Only if it rejected the cookie the user still has: a late 401 for an older cookie must not
    // clear the one a re-login stored meanwhile.
    else if (res.code === 401 && res.meta.authError === 'session-lost' && res.meta.sessionId === ctx.state.cookies[k]) {
      ctx.state.cookies[k] = null
    }
  },
  // Resize the cookies as soon as `users` changes, even while paused.
  onConfig(ctx) {
    syncUsers(ctx)
  },
  onTick(ctx, dtMs) {
    syncUsers(ctx)
    ctx.state.acc += (ctx.config.rate * dtMs) / 1000
    while (ctx.state.acc >= 1) {
      ctx.state.acc -= 1
      sendOne(ctx)
    }
  },
  actions: {
    send1: { label: 'Enviar 1', run: (ctx) => sendOne(ctx) },
    burst: {
      label: 'Ráfaga',
      run(ctx) {
        const n = ctx.config.burstSize
        for (let i = 0; i < n; i++) ctx.schedule((i * BURST_WINDOW_MS) / n, () => sendOne(ctx))
      },
    },
  },
})
