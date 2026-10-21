import { describe, expect, it } from 'vitest'
import { client, type ClientState } from '../../src/components/client'
import { loadBalancer } from '../../src/components/load-balancer'
import { Registry, defineComponent } from '../../src/engine/registry'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ nodes, edges })

/**
 * A test server holding sessions in memory. User 0 is answered slowly and the others fast, so
 * responses arrive out of order. `wipe` forgets every session.
 */
const sess = defineComponent<Record<string, never>, { valid: string[] }>({
  type: 'sess',
  label: 'Sess',
  icon: 's',
  color: 'ok',
  config: {},
  initialState: () => ({ valid: [] }),
  onMessage(msg, ctx) {
    const delay = msg.meta.userIndex === 0 ? 2000 : 0
    ctx.schedule(delay, () => {
      const sid = msg.meta.sessionId
      if (typeof sid === 'string') {
        if (ctx.state.valid.includes(sid)) ctx.reply(msg, { status: 'ok', code: 200 })
        else ctx.reply(msg, { status: 'error', code: 401, meta: { authError: 'session-lost' } })
      } else if (msg.meta.credentials) {
        const id = `sid:${msg.id}`
        ctx.state.valid.push(id)
        ctx.reply(msg, { status: 'ok', code: 200, meta: { setSession: id } })
      } else {
        ctx.reply(msg, { status: 'error', code: 401, meta: { authError: 'unauthenticated' } })
      }
    })
  },
  actions: {
    wipe: {
      label: 'Wipe',
      run(ctx) {
        ctx.state.valid = []
      },
    },
  },
})

function registry(): Registry {
  const r = new Registry()
  for (const d of [client, loadBalancer, sess]) r.register(d)
  return r
}

const sim = (g: Graph) => new Simulation(g, { seed: 3, registry: registry() })

/** Requests sent by `from`. */
function requestsFrom(s: Simulation, from: string): Message[] {
  const out: Message[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from && p.msg.kind === 'request') out.push(p.msg)
  })
  return out
}

function responsesAt(s: Simulation, at: string): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === 'response') out.push(p.msg)
  })
  return out
}

const cookies = (s: Simulation, id = 'C') => s.nodeState<ClientState>(id).cookies

describe('client users and auth fields', () => {
  it('has users (1..50, default 1) and auth (login | none, default login)', () => {
    expect(client.config.users).toMatchObject({ type: 'number', default: 1, min: 1, max: 50 })
    expect(client.config.auth).toMatchObject({ type: 'select', default: 'login' })
    const auth = client.config.auth
    expect(auth.type === 'select' && auth.options.map((o) => o.value)).toEqual(['login', 'none'])
  })
})

describe('client users', () => {
  it('round-robins its users: userIndex 0..N-1 and clientIp "<ip>#k" (k from 1)', () => {
    const s = sim(graph([node('C', 'client', { users: 3, ip: '10.0.0.1' }), node('S', 'sess')], [edge('C', 'S')]))
    const sent = requestsFrom(s, 'C')
    for (let i = 0; i < 4; i++) s.runAction('C', 'send1')
    expect(sent.map((m) => m.meta.userIndex)).toEqual([0, 1, 2, 0])
    expect(sent.map((m) => m.meta.clientIp)).toEqual(['10.0.0.1#1', '10.0.0.1#2', '10.0.0.1#3', '10.0.0.1#1'])
  })

  it('with a single user the IP stays as it is', () => {
    const s = sim(graph([node('C', 'client', { ip: '10.0.0.1' }), node('S', 'sess')], [edge('C', 'S')]))
    const sent = requestsFrom(s, 'C')
    s.runAction('C', 'send1')
    s.runAction('C', 'send1')
    expect(sent.map((m) => [m.meta.userIndex, m.meta.clientIp])).toEqual([
      [0, '10.0.0.1'],
      [0, '10.0.0.1'],
    ])
  })
})

describe('client cookies', () => {
  it('stores each setSession on the user who made the request, even with out-of-order responses through an LB', () => {
    const s = sim(graph([node('C', 'client', { users: 2 }), node('L', 'load-balancer'), node('S', 'sess')], [edge('C', 'L'), edge('L', 'S')]))
    const sent = requestsFrom(s, 'C')
    const got = responsesAt(s, 'C')
    s.runAction('C', 'send1') // user 0, slow
    s.runAction('C', 'send1') // user 1, fast
    expect(sent.map((m) => [m.meta.credentials, m.meta.sessionId])).toEqual([
      [true, undefined],
      [true, undefined],
    ])
    s.advance(10_000)
    // User 1's response came back first.
    expect(got.map((r) => r.meta.userIndex)).toEqual([1, 0])
    expect(cookies(s)).toEqual([`sid:${sent[0].id}`, `sid:${sent[1].id}`])
    s.runAction('C', 'send1')
    s.runAction('C', 'send1')
    expect(sent.slice(2).map((m) => m.meta.sessionId)).toEqual([`sid:${sent[0].id}`, `sid:${sent[1].id}`])
  })

  it('a 401 session-lost clears only that user\'s cookie; the next request logs in again', () => {
    const s = sim(graph([node('C', 'client', { users: 2 }), node('S', 'sess')], [edge('C', 'S')]))
    const sent = requestsFrom(s, 'C')
    s.runAction('C', 'send1')
    s.runAction('C', 'send1')
    s.advance(10_000)
    const [c0, c1] = cookies(s)
    s.runAction('S', 'wipe')
    s.runAction('C', 'send1') // user 0 with a stale cookie → 401 session-lost
    s.advance(10_000)
    expect(cookies(s)).toEqual([null, c1])
    expect(c0).not.toBeNull()
    s.runAction('C', 'send1') // user 1, keeps its (stale) cookie
    s.runAction('C', 'send1') // user 0, logs in again
    const relogin = sent[sent.length - 1]
    expect(relogin.meta).toMatchObject({ userIndex: 0, credentials: true })
    expect(relogin.meta.sessionId).toBeUndefined()
  })

  it('auth none sends no credentials nor cookie, and 401 unauthenticated changes nothing', () => {
    const s = sim(graph([node('C', 'client', { users: 2 }), node('S', 'sess')], [edge('C', 'S')]))
    const sent = requestsFrom(s, 'C')
    s.runAction('C', 'send1')
    s.runAction('C', 'send1')
    s.advance(10_000)
    const before = [...cookies(s)]
    expect(before.every((c) => typeof c === 'string')).toBe(true)
    s.setGraph(graph([node('C', 'client', { users: 2, auth: 'none' }), node('S', 'sess')], [edge('C', 'S')]))
    const got = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.runAction('C', 'send1')
    s.advance(10_000)
    for (const m of sent.slice(2)) {
      expect(m.meta.credentials).toBeUndefined()
      expect(m.meta.sessionId).toBeUndefined()
    }
    expect(got.map((r) => [r.code, r.meta.authError])).toEqual([
      [401, 'unauthenticated'],
      [401, 'unauthenticated'],
    ])
    expect(cookies(s)).toEqual(before)
  })

  it('resizes the cookies when users changes: new users have none, removed users are dropped', () => {
    const g = (users: number) => graph([node('C', 'client', { users }), node('S', 'sess')], [edge('C', 'S')])
    const s = sim(g(3))
    s.advance(100)
    expect(cookies(s)).toEqual([null, null, null])
    for (let i = 0; i < 3; i++) s.runAction('C', 'send1')
    s.advance(10_000)
    const [a, b] = cookies(s)
    s.setGraph(g(2))
    s.advance(100)
    expect(cookies(s)).toEqual([a, b])
    s.setGraph(g(4))
    s.advance(100)
    expect(cookies(s)).toEqual([a, b, null, null])
  })

  it('a late response for a user that no longer exists is ignored', () => {
    const g = (users: number) => graph([node('C', 'client', { users }), node('S', 'sess')], [edge('C', 'S')])
    const s = sim(g(2))
    s.runAction('C', 'send1') // user 0 (slow)
    s.runAction('C', 'send1') // user 1 (fast)
    s.advance(100)
    s.setGraph(g(1))
    s.advance(10_000)
    expect(cookies(s)).toHaveLength(1)
    expect(cookies(s)[0]).toMatch(/^sid:/)
  })
})
