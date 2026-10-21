import { describe, expect, it } from 'vitest'
import { parseBehavior, validateBehavior, type DslError } from '../../../src/components/behavior'
import type { ClientState } from '../../../src/components/client'
import type { DatabaseState } from '../../../src/components/database'
import { defaultRegistry } from '../../../src/components/index'
import { Simulation } from '../../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../../src/engine/types'

/*
 * The `session` step (docs/sessions-spec.md §4). Engine-level tests: real Simulation, real components.
 * Timeline: one hop = 600 ms; S and DB process in 100 ms. A request sent at t reaches S at t+600,
 * runs its handler at t+700; a DB round trip adds 600 + 100 + 600.
 */

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { name: id, ...config },
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ nodes, edges })

const codes = (errors: DslError[]) => errors.map((e) => [e.code, e.line])

type Store = 'memory' | 'database' | 'jwt'
const STORES: Store[] = ['memory', 'database', 'jwt']
const stepFor = (store: Store) => (store === 'database' ? 'session Sesiones' : `session ${store}`)

interface Opts {
  /** Handler body after the session step (default `reply 201`). */
  after?: string
  client?: Record<string, unknown>
  db?: Record<string, unknown>
  service?: Record<string, unknown>
  /** Full behavior text, overriding the generated one. */
  behavior?: string
}

/** C → S (service with a `session` step) → Sesiones (database) and T (a plain service). */
function setup(store: Store, opts: Opts = {}) {
  const behavior = opts.behavior ?? `on request:\n  ${stepFor(store)}\n  ${opts.after ?? 'reply 201'}\n`
  const g = graph(
    [
      node('C', 'client', opts.client),
      node('S', 'service', { processingTime: 100, behavior, ...opts.service }),
      node('Sesiones', 'database', { processingTime: 100, ...opts.db }),
      node('T', 'service', { processingTime: 100 }),
    ],
    [edge('C', 'S'), edge('S', 'Sesiones'), edge('S', 'T')],
  )
  const s = new Simulation(g, { seed: 3, registry: defaultRegistry })
  const responses: { time: number; msg: Message }[] = []
  const arrivals: { at: string; time: number; msg: Message }[] = []
  s.on('message:arrived', (p) => {
    if (p.at === 'C' && p.msg.kind === 'response') responses.push({ time: s.now, msg: p.msg })
    if (p.msg.kind !== 'response') arrivals.push({ at: p.at, time: s.now, msg: p.msg })
  })
  return {
    s,
    g,
    responses,
    arrivalsAt: (at: string) => arrivals.filter((a) => a.at === at),
    send: () => s.runAction('C', 'send1'),
    cookies: () => s.nodeState<ClientState>('C').cookies,
    setCookie: (v: string | null, k = 0) => {
      const st = s.nodeState<ClientState>('C')
      while (st.cookies.length <= k) st.cookies.push(null)
      st.cookies[k] = v
    },
    memory: (id = 'S') => s.nodeState<{ sessions: string[] }>(id).sessions,
    dbSessions: () => s.nodeState<DatabaseState>('Sesiones').sessions,
    last: () => responses[responses.length - 1]?.msg,
  }
}

const summary = (m: Message | undefined) => m && { status: m.status, code: m.code, setSession: m.meta.setSession, authError: m.meta.authError }

describe('session: database request meta', () => {
  it('carries only identity, color and the session op: no credentials, user or IP', () => {
    const t = setup('database', { client: { users: 2, ip: '10.0.0.9', color: '#3b82f6' } })
    t.send()
    t.s.advance(5_000)
    const meta = t.arrivalsAt('Sesiones')[0].msg.meta
    expect(Object.keys(meta).sort()).toEqual(['clientColor', 'clientId', 'clientName', 'sessionId', 'sessionOp'])
    expect(meta).toMatchObject({ clientId: 'C', clientColor: '#3b82f6', sessionOp: 'create' })
  })
})

describe('session: parse', () => {
  it('memory, jwt and a database target (quoted or not), with or modifiers', () => {
    const { program, errors } = parseBehavior(
      'on request:\n  session memory\n  session jwt\n  session Base de datos or reply 599\n  session "memory" or continue\n  session memory store\n',
    )
    expect(errors).toEqual([])
    expect(program.handlers[0].steps).toEqual([
      { kind: 'session', line: 2, store: { kind: 'memory' } },
      { kind: 'session', line: 3, store: { kind: 'jwt' } },
      { kind: 'session', line: 4, store: { kind: 'database', target: 'Base de datos' }, mod: { kind: 'orReply', code: 599 } },
      { kind: 'session', line: 5, store: { kind: 'database', target: 'memory' }, mod: { kind: 'orContinue' } },
      { kind: 'session', line: 6, store: { kind: 'database', target: 'memory store' } },
    ])
  })

  it('session without a store is missing-target; nowait is session-nowait', () => {
    const { errors } = parseBehavior('on request:\n  session\n  session or continue\n  session memory nowait\n  session BD nowait\n  session jwt "x"\n')
    // `session jwt extra` would be a database named "jwt extra": the keywords count only alone.
    expect(codes(errors)).toEqual([
      ['missing-target', 2],
      ['missing-target', 3],
      ['session-nowait', 4],
      ['session-nowait', 5],
      ['unknown-keyword', 6],
    ])
  })

  it('session outside a handler is step-outside-handler', () => {
    expect(codes(parseBehavior('session memory\n').errors)).toEqual([['step-outside-handler', 1]])
  })
})

describe('session: validate', () => {
  const outputs = [
    { name: 'Sesiones', type: 'database' },
    { name: 'Cache', type: 'cache' },
    { name: 'Pagos', type: 'service' },
  ]
  const validate = (text: string) => codes(validateBehavior(parseBehavior(text).program, outputs))

  it('memory and jwt need no output; a database target must be connected and a database', () => {
    expect(validate('on request:\n  session memory\n  session jwt\n  session Sesiones\n  session Sesiones\n')).toEqual([])
    expect(validate('on request:\n  session Otra\n')).toEqual([['not-connected', 2]])
    const errs = validateBehavior(parseBehavior('on request:\n  session Cache\n  session Pagos\n  parallel:\n    session Pagos\n').program, outputs)
    expect(errs).toEqual([
      { line: 2, code: 'wrong-verb', params: { verb: 'session', target: 'Cache', type: 'cache', suggestion: 'query' } },
      { line: 3, code: 'wrong-verb', params: { verb: 'session', target: 'Pagos', type: 'service', suggestion: 'call' } },
      { line: 5, code: 'wrong-verb', params: { verb: 'session', target: 'Pagos', type: 'service', suggestion: 'call' } },
    ])
  })
})

describe('session: spec §4 table', () => {
  describe.each(STORES)('%s', (store) => {
    it('no cookie + credentials → login: continues, the final reply carries setSession, the client keeps it', () => {
      const t = setup(store)
      t.send()
      t.s.advance(5000)
      const res = t.last()
      const id = t.arrivalsAt('S')[0].msg.id
      const token = store === 'jwt' ? `jwt:${id}` : `sid:${id}`
      expect(summary(res)).toEqual({ status: 'ok', code: 201, setSession: token, authError: undefined })
      expect(t.cookies()[0]).toBe(token)
      if (store === 'memory') expect(t.memory()).toEqual([token])
      if (store === 'database') {
        expect(t.dbSessions()).toEqual([token])
        expect(t.arrivalsAt('Sesiones')[0].msg.meta).toMatchObject({ sessionOp: 'create', sessionId: token })
      } else {
        expect(t.arrivalsAt('Sesiones')).toEqual([])
      }
      expect(t.s.nodeStats('S').inFlight).toBe(0)
    })

    it('valid cookie → continues, no new setSession', () => {
      const t = setup(store)
      t.send()
      t.s.advance(5000)
      const token = t.cookies()[0]
      t.send()
      t.s.advance(5000)
      expect(summary(t.last())).toEqual({ status: 'ok', code: 201, setSession: undefined, authError: undefined })
      expect(t.last()!.meta.sessionId).toBe(token)
      expect(t.cookies()[0]).toBe(token)
      if (store === 'database') expect(t.arrivalsAt('Sesiones')[1].msg.meta).toMatchObject({ sessionOp: 'check', sessionId: token })
    })

    it('cookie unknown to the store (or of another kind) → 401 session-lost, the handler ends, the client clears it', () => {
      const t = setup(store, { after: 'call T /x' })
      t.setCookie('sid:ghost')
      t.send()
      t.s.advance(5000)
      expect(summary(t.last())).toEqual({ status: 'error', code: 401, setSession: undefined, authError: 'session-lost' })
      expect(t.arrivalsAt('T')).toEqual([])
      expect(t.cookies()[0]).toBe(null)
      expect(t.s.nodeStats('S').inFlight).toBe(0)
      // The next request logs in again.
      t.send()
      t.s.advance(5000)
      expect(t.last()!.meta.setSession).toMatch(store === 'jwt' ? /^jwt:/ : /^sid:/)
    })

    it('no cookie, no credentials → 401 unauthenticated with no network hop', () => {
      const t = setup(store, { client: { auth: 'none' }, after: 'call T /x' })
      t.send()
      t.s.advance(5000)
      expect(summary(t.last())).toEqual({ status: 'error', code: 401, setSession: undefined, authError: 'unauthenticated' })
      expect(t.responses[0].time).toBe(1300)
      expect(t.arrivalsAt('Sesiones')).toEqual([])
      expect(t.arrivalsAt('T')).toEqual([])
    })

    it('in an event handler the step is a no-op', () => {
      const t = setup(store, { client: { kind: 'event' }, behavior: `on event:\n  ${stepFor(store)}\n  call T /x\n` })
      t.send()
      t.s.advance(5000)
      expect(t.arrivalsAt('Sesiones')).toEqual([])
      expect(t.arrivalsAt('T')).toHaveLength(1)
      expect(t.s.nodeStats('S').inFlight).toBe(0)
      if (store === 'memory') expect(t.memory()).toEqual([])
    })

    it('a later `reply 401` never carries setSession; an `or reply N` after login does', () => {
      const t = setup(store, { after: 'reply 401' })
      t.send()
      t.s.advance(5000)
      expect(summary(t.last())).toEqual({ status: 'error', code: 401, setSession: undefined, authError: undefined })
      const u = setup(store, { after: 'call T /x or reply 402', service: {} })
      u.s.setGraph({ ...u.g, nodes: u.g.nodes.map((n) => (n.id === 'T' ? { ...n, config: { ...n.config, up: false } } : n)) })
      u.send()
      u.s.advance(5000)
      expect(u.last()!.code).toBe(402)
      expect(u.last()!.meta.setSession).toMatch(store === 'jwt' ? /^jwt:/ : /^sid:/)
    })
  })

  it('timing: a database login adds the round trip to the store', () => {
    const t = setup('database')
    t.send()
    t.s.advance(5000)
    // S runs at 700, create reaches DB at 1300, done 1400, back at S 2000, client at 2600.
    expect(t.responses[0].time).toBe(2600)
    const m = setup('memory')
    m.send()
    m.s.advance(5000)
    expect(m.responses[0].time).toBe(1300)
  })

  it('a jwt cookie on a memory service is session-lost; a sid cookie on a jwt service too', () => {
    const t = setup('memory')
    t.setCookie('jwt:abc')
    t.send()
    t.s.advance(5000)
    expect(summary(t.last())).toMatchObject({ code: 401, authError: 'session-lost' })
    const j = setup('jwt')
    j.setCookie('sid:abc')
    j.send()
    j.s.advance(5000)
    expect(summary(j.last())).toMatchObject({ code: 401, authError: 'session-lost' })
    // Any jwt: token is valid (shared simulated signature).
    const k = setup('jwt')
    k.setCookie('jwt:issued-elsewhere')
    k.send()
    k.s.advance(5000)
    expect(summary(k.last())).toEqual({ status: 'ok', code: 201, setSession: undefined, authError: undefined })
  })
})

describe('session: a failing store', () => {
  it('database down → the step fails with 503 by default; the slot is released', () => {
    const t = setup('database', { db: { up: false }, after: 'call T /x' })
    t.send()
    t.s.advance(5000)
    expect(summary(t.last())).toEqual({ status: 'error', code: 503, setSession: undefined, authError: undefined })
    expect(t.arrivalsAt('T')).toEqual([])
    expect(t.cookies()[0]).toBe(null)
    expect(t.s.nodeStats('S').inFlight).toBe(0)
    expect(t.s.nodeState<{ behaviorPending: object }>('S').behaviorPending).toEqual({})
  })

  it('`or reply N` and `or continue` apply to a down store (check and create)', () => {
    const r = setup('database', { db: { up: false }, behavior: 'on request:\n  session Sesiones or reply 599\n  reply 201\n' })
    r.send()
    r.s.advance(5000)
    expect(summary(r.last())).toEqual({ status: 'error', code: 599, setSession: undefined, authError: undefined })

    const c = setup('database', { db: { up: false }, behavior: 'on request:\n  session Sesiones or continue\n  reply 201\n' })
    c.send()
    c.s.advance(5000)
    // The session was not created, so there is nothing to set.
    expect(summary(c.last())).toEqual({ status: 'ok', code: 201, setSession: undefined, authError: undefined })
    c.setCookie('sid:whatever')
    c.send()
    c.s.advance(5000)
    expect(summary(c.last())).toEqual({ status: 'ok', code: 201, setSession: undefined, authError: undefined })
    expect(c.s.nodeStats('S').inFlight).toBe(0)
  })

  it('memory and jwt cannot fail: or modifiers parse and change nothing', () => {
    for (const store of ['memory', 'jwt'] as const) {
      const t = setup(store, { behavior: `on request:\n  session ${store} or reply 599\n  reply 201\n` })
      t.send()
      t.s.advance(5000)
      expect(t.last()!.code).toBe(201)
    }
  })

  it('Review Focus 2: the database goes down while a check is on its way → 503 and the slot is freed', () => {
    const t = setup('database')
    t.send()
    t.s.advance(5000)
    t.send() // check: S runs at 5700, the check reaches the DB at 6300
    t.s.advance(1000) // t = 6000: check on the wire
    t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'Sesiones' ? { ...n, config: { ...n.config, up: false } } : n)) })
    t.s.advance(5000)
    expect(summary(t.last())).toEqual({ status: 'error', code: 503, setSession: undefined, authError: undefined })
    expect(t.cookies()[0]).not.toBe(null) // a store failure is not a lost session
    expect(t.s.nodeStats('S').inFlight).toBe(0)
    expect(t.s.nodeState<{ behaviorPending: object }>('S').behaviorPending).toEqual({})
  })

  it('the database is deleted mid-check → the step fails (503) and the slot is freed', () => {
    const t = setup('database')
    t.send()
    t.s.advance(5000)
    t.send()
    t.s.advance(1000)
    t.s.setGraph({ nodes: t.g.nodes.filter((n) => n.id !== 'Sesiones'), edges: t.g.edges.filter((e) => e.target !== 'Sesiones') })
    t.s.advance(5000)
    // The DSL now has an error (Sesiones not connected) for new messages, but the running handler fails cleanly.
    expect(t.last()!.code).toBe(503)
    expect(t.s.nodeStats('S').inFlight).toBe(0)
    expect(t.s.nodeState<{ behaviorPending: object }>('S').behaviorPending).toEqual({})
  })
})

describe('session memory: volatility', () => {
  const toggle = (t: ReturnType<typeof setup>, up: boolean) =>
    t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'S' ? { ...n, config: { ...n.config, up } } : n)) })

  it('is emptied when the service goes Activo = off, even while paused (no tick in between)', () => {
    const t = setup('memory')
    t.send()
    t.s.advance(5000)
    expect(t.memory()).toHaveLength(1)
    toggle(t, false)
    expect(t.memory()).toEqual([])
    toggle(t, true)
    t.send()
    t.s.advance(5000)
    expect(summary(t.last())).toMatchObject({ code: 401, authError: 'session-lost' })
    expect(t.cookies()[0]).toBe(null)
  })

  it('is per component: two services do not share sessions', () => {
    const t = setup('memory')
    t.send()
    t.s.advance(5000)
    expect(t.memory('T')).toEqual([])
  })
})

describe('session memory behind a round-robin LB without sticky', () => {
  function lane(users: number) {
    const behavior = 'on request:\n  session memory\n'
    const g = graph(
      [
        node('C', 'client', { users }),
        node('LB', 'load-balancer'),
        ...['S1', 'S2', 'S3'].map((id) => node(id, 'service', { processingTime: 100, behavior })),
      ],
      [edge('C', 'LB'), edge('LB', 'S1'), edge('LB', 'S2'), edge('LB', 'S3')],
    )
    const s = new Simulation(g, { seed: 3, registry: defaultRegistry })
    const res: Message[] = []
    s.on('message:arrived', (p) => {
      if (p.at === 'C' && p.msg.kind === 'response') res.push(p.msg)
    })
    // One request every 3 s, so each completes (2.5 s through the LB) before the next.
    for (let i = 0; i < 24; i++) {
      s.runAction('C', 'send1')
      s.advance(3000)
    }
    return { s, res }
  }

  it('with 5 users and 3 services: 401 session-lost churn, and users log in again', () => {
    const { s, res } = lane(5)
    const lost = res.filter((m) => m.meta.authError === 'session-lost')
    const logins = res.filter((m) => m.meta.setSession !== undefined)
    expect(lost.length).toBeGreaterThan(5)
    expect(logins.length).toBeGreaterThan(5)
    // Every 401 is followed by a login of the same user (Review Focus 1).
    for (const m of lost) {
      const later = res.slice(res.indexOf(m) + 1).find((r) => r.meta.userIndex === m.meta.userIndex)
      if (later) expect(later.meta.setSession).toMatch(/^sid:/)
    }
    const total = ['S1', 'S2', 'S3'].reduce((n, id) => n + s.nodeState<{ sessions: string[] }>(id).sessions.length, 0)
    expect(total).toBe(logins.length)
  })

  it('with 6 users and 3 services the two round robins line up: user k always lands on S(k mod 3)', () => {
    // Documented quirk (see the task report): 6 is a multiple of 3, so plain round robin is sticky by accident.
    const { res } = lane(6)
    expect(res.filter((m) => m.meta.authError === 'session-lost')).toEqual([])
    expect(res.filter((m) => m.meta.setSession !== undefined)).toHaveLength(6)
  })
})
