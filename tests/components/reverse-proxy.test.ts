import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { ClientState } from '../../src/components/client'
import { proxyAuthDecision } from '../../src/components/reverse-proxy'
import type { EdgeRule, Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string, rule?: EdgeRule): GraphEdge => ({ id: `${source}-${target}`, source, target, rule })
const prefix = (value: string): EdgeRule => ({ kind: 'pathPrefix', value })
const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

function sentFrom(s: Simulation, from: string): { msg: Message; to: string }[] {
  const out: { msg: Message; to: string }[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from && p.msg.kind === 'request') out.push({ msg: p.msg, to: p.to })
  })
  return out
}

function clientResponses(s: Simulation, at: string): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === 'response') out.push(p.msg)
  })
  return out
}

/** C → P → services, each service edge with an optional rule. */
function proxyGraph(
  proxyConfig: Record<string, unknown>,
  routes: [string, EdgeRule | undefined][],
  clientConfig: Record<string, unknown> = {},
): Graph {
  return {
    nodes: [
      node('C', 'client', { rate: 0, ...clientConfig }),
      node('P', 'reverse-proxy', proxyConfig),
      ...routes.map(([id]) => node(id, 'service')),
    ],
    edges: [edge('C', 'P'), ...routes.map(([id, rule]) => edge('P', id, rule))],
  }
}

const mixOf = (value: string) => ({ mix: [{ value, weight: 1 }] })

describe('reverse proxy', () => {
  it('has catalog metadata and config', () => {
    const d = defaultRegistry.get('reverse-proxy')!
    expect([d.label, d.icon, d.color]).toEqual(['Reverse Proxy', '🚪', 'req'])
    expect(d.config.authFailRate).toBeUndefined()
    expect(d.config.auth).toMatchObject({
      type: 'select',
      default: 'none',
      options: [{ value: 'none' }, { value: 'credentials' }, { value: 'jwt' }],
    })
    expect(d.config.rateLimit).toMatchObject({ type: 'number', label: 'Rate limit', default: 0, min: 0, max: 100, unit: 'req/s' })
    expect(d.config.cacheHitRate).toMatchObject({ type: 'number', label: 'Cache hit', default: 0, min: 0, max: 1 })
  })

  it('routes to the longest matching prefix', () => {
    const s = sim(proxyGraph({}, [['S1', prefix('/ordenes')], ['S2', prefix('/ordenes/envios')]], mixOf('/ordenes/envios')))
    const sent = sentFrom(s, 'P')
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(sent.map((e) => e.to)).toEqual(['S2'])
    expect(res.map((r) => r.code)).toEqual([200])
  })

  it('an edge without a rule catches unmatched paths; specific rules still win', () => {
    const routes: [string, EdgeRule | undefined][] = [['S1', prefix('/ordenes')], ['S2', undefined]]
    const s = sim(proxyGraph({}, routes, { burstSize: 2, mix: [{ value: '/otra', weight: 1 }] }))
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(sent.map((e) => e.to)).toEqual(['S2', 'S2'])

    const s2 = sim(proxyGraph({}, routes, mixOf('/ordenes/1')))
    const sent2 = sentFrom(s2, 'P')
    s2.runAction('C', 'send1')
    s2.advance(5000)
    expect(sent2.map((e) => e.to)).toEqual(['S1'])
  })

  it('no match → 404 reply (not a drop)', () => {
    const s = sim(proxyGraph({}, [['S1', prefix('/ordenes')]], mixOf('/otra')))
    const res = clientResponses(s, 'C')
    const drops: unknown[] = []
    s.on('message:dropped', (p) => drops.push(p))
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => [r.status, r.code])).toEqual([['error', 404]])
    expect(drops).toEqual([])
  })

  it('rateLimit 1 with 5 requests in 1s → 4 replies are 429', () => {
    const s = sim(proxyGraph({ rateLimit: 1 }, [['S1', undefined]], { burstSize: 5 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(res).toHaveLength(5)
    expect(res.filter((r) => r.code === 429)).toHaveLength(4)
    expect(res.filter((r) => r.code === 200)).toHaveLength(1)
  })

  it('rate limit window slides: rejected requests do not count and old ones expire', () => {
    const s = sim(proxyGraph({ rateLimit: 1 }, [['S1', undefined]], { burstSize: 1 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(1100)
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(res.map((r) => r.code)).toEqual([200, 200])
  })

  it('cacheHitRate 1 → no request reaches a service, replies 200', () => {
    const s = sim(proxyGraph({ cacheHitRate: 1 }, [['S1', undefined]], { burstSize: 5 }))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    const labels: string[] = []
    s.on('node:label', (p) => labels.push(`${p.nodeId}:${p.text}:${p.tone}`))
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(sent).toHaveLength(0)
    expect(res.map((r) => r.code)).toEqual([200, 200, 200, 200, 200])
    expect(s.nodeStats('S1').ok).toBe(0)
    expect(labels).toEqual(Array(5).fill('P:HIT:redis'))
  })
})

describe('reverse proxy auth (sessions spec §8)', () => {
  it('decision table', () => {
    const d = (mode: 'none' | 'credentials' | 'jwt', meta: Record<string, unknown>) => proxyAuthDecision(mode, meta)
    expect(d('none', {})).toBe('pass')
    expect(d('credentials', {})).toBe('reject')
    expect(d('credentials', { credentials: true })).toBe('pass')
    expect(d('credentials', { sessionId: 'sid:1' })).toBe('pass')
    expect(d('jwt', {})).toBe('reject')
    expect(d('jwt', { sessionId: 'jwt:1' })).toBe('pass')
    expect(d('jwt', { credentials: true, sessionId: 'jwt:1' })).toBe('pass')
    expect(d('jwt', { credentials: true })).toBe('issue')
    // A sid: cookie counts as no token.
    expect(d('jwt', { sessionId: 'sid:1' })).toBe('reject')
    expect(d('jwt', { credentials: true, sessionId: 'sid:1' })).toBe('issue')
    // An unknown mode behaves like none.
    expect(d('bogus' as 'none', {})).toBe('pass')
  })

  it('none (default) lets requests without credentials through', () => {
    const s = sim(proxyGraph({}, [['S1', undefined]], { auth: 'none', burstSize: 2 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([200, 200])
  })

  it('credentials: no credentials → 401 unauthenticated without routing', () => {
    const s = sim(proxyGraph({ auth: 'credentials' }, [['S1', undefined]], { auth: 'none', burstSize: 3 }))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => [r.code, r.meta.authError])).toEqual(Array(3).fill([401, 'unauthenticated']))
    expect(sent).toHaveLength(0)
  })

  it('credentials: a client with login passes and gets no token', () => {
    const s = sim(proxyGraph({ auth: 'credentials' }, [['S1', undefined]], { burstSize: 2 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => [r.code, r.meta.setSession])).toEqual([
      [200, undefined],
      [200, undefined],
    ])
  })

  it('auth comes after the rate limit: a 429 is not a 401', () => {
    const s = sim(proxyGraph({ auth: 'credentials', rateLimit: 1 }, [['S1', undefined]], { auth: 'none', burstSize: 2 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => r.code).sort()).toEqual([401, 429])
  })

  it('jwt: issues jwt:<request id> on the way back; the client stores it and later passes with it', () => {
    const s = sim(proxyGraph({ auth: 'jwt' }, [['S1', undefined]]))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res).toHaveLength(1)
    expect(res[0].code).toBe(200)
    expect(res[0].meta.setSession).toBe(`jwt:${sent[0].msg.id}`)
    expect(s.nodeState<ClientState>('C').cookies).toEqual([`jwt:${sent[0].msg.id}`])

    s.runAction('C', 'send1')
    s.advance(5000)
    expect(sent).toHaveLength(2)
    expect(sent[1].msg.meta.sessionId).toBe(`jwt:${sent[0].msg.id}`)
    expect(res[1].code).toBe(200)
    expect(res[1].meta.setSession).toBeUndefined()
    // The proxy forgets the request once its response went back.
    expect(s.nodeState<{ issue: Record<string, true> }>('P').issue).toEqual({})
  })

  it('jwt: no credentials and no token → 401 unauthenticated', () => {
    const s = sim(proxyGraph({ auth: 'jwt' }, [['S1', undefined]], { auth: 'none' }))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => [r.code, r.meta.authError])).toEqual([[401, 'unauthenticated']])
    expect(sent).toHaveLength(0)
  })

  it('jwt: a sid: cookie counts as no token; with credentials a new JWT is issued', () => {
    const s = sim(proxyGraph({ auth: 'jwt' }, [['S1', undefined]]))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    s.advance(100) // first tick sizes the cookies
    s.nodeState<ClientState>('C').cookies[0] = 'sid:old'
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(sent[0].msg.meta.sessionId).toBe('sid:old')
    expect(res[0].meta.setSession).toBe(`jwt:${sent[0].msg.id}`)
  })

  it('jwt: a 401 from downstream carries no token', () => {
    const g = proxyGraph({ auth: 'jwt' }, [['S1', undefined]])
    g.nodes = g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { behavior: 'on request:\n  reply 401\n' } } : n))
    const s = sim(g)
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => [r.code, r.meta.setSession])).toEqual([[401, undefined]])
    expect(s.nodeState<ClientState>('C').cookies).toEqual([null])
  })

  it('jwt: a downstream error that is not a 401 still carries the token', () => {
    const g = proxyGraph({ auth: 'jwt' }, [['S1', undefined]])
    g.nodes = g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { up: false } } : n))
    const s = sim(g)
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res[0].code).toBe(503)
    expect(res[0].meta.setSession).toMatch(/^jwt:/)
  })

  it('jwt: the token patch does not leak into the meta seen at earlier hops', () => {
    const s = sim(proxyGraph({ auth: 'jwt' }, [['S1', undefined]]))
    const atP: Message[] = []
    s.on('message:arrived', (p) => {
      if (p.at === 'P' && p.msg.kind === 'response') atP.push(p.msg)
    })
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(atP).toHaveLength(1)
    expect(atP[0].meta.setSession).toBeUndefined()
  })

  it('jwt: a cache hit after auth also issues the token', () => {
    const s = sim(proxyGraph({ auth: 'jwt', cacheHitRate: 1 }, [['S1', undefined]]))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res[0].code).toBe(200)
    expect(res[0].meta.setSession).toMatch(/^jwt:/)
  })

  it('jwt in front of a service with `session jwt`: logged-in users pass the service check', () => {
    const g = proxyGraph({ auth: 'jwt' }, [['S1', undefined]], { users: 3 })
    g.nodes = g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { behavior: 'on request:\n  session jwt\n' } } : n))
    const s = sim(g)
    const res = clientResponses(s, 'C')
    for (let i = 0; i < 9; i++) {
      s.runAction('C', 'send1')
      s.advance(3000)
    }
    expect(res).toHaveLength(9)
    expect(res.every((r) => r.code === 200)).toBe(true)
    expect(res.filter((r) => r.meta.setSession).length).toBe(3)
  })

  it('events are not authenticated (only requests carry credentials)', () => {
    const s = sim(proxyGraph({ auth: 'credentials' }, [['S1', undefined]], { auth: 'none', kind: 'event' }))
    const sent: Message[] = []
    s.on('message:sent', (p) => {
      if (p.from === 'P') sent.push(p.msg)
    })
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(sent.filter((m) => m.kind === 'event')).toHaveLength(1)
  })
})
