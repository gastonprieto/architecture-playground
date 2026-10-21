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
    expect(d.config.cacheHitRate).toBeUndefined()
    expect(d.config.cache).toMatchObject({
      type: 'select',
      default: 'off',
      options: [{ value: 'off' }, { value: 'random' }, { value: 'keys' }],
    })
    expect(d.config.hitRate).toMatchObject({ type: 'number', default: 0.8, min: 0, max: 1, showIf: { field: 'cache', equals: 'random' } })
    expect(d.config.capacity).toMatchObject({ type: 'number', default: 50, min: 1, max: 1000, showIf: { field: 'cache', equals: 'keys' } })
    expect(d.config.ttl).toMatchObject({ type: 'number', default: 0, min: 0, max: 600000, showIf: { field: 'cache', equals: 'keys' } })
    expect(d.config.cacheablePaths).toMatchObject({ type: 'list', default: ['/static'], showIf: { field: 'cache', notEquals: 'off' } })
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

  it('random edge cache with hitRate 1 over every path → no request reaches a service, replies 200 HIT', () => {
    const s = sim(proxyGraph({ cache: 'random', hitRate: 1, cacheablePaths: [] }, [['S1', undefined]], { burstSize: 5 }))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    const labels: string[] = []
    s.on('node:label', (p) => labels.push(`${p.nodeId}:${p.text}:${p.tone}`))
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(sent).toHaveLength(0)
    expect(res.map((r) => r.code)).toEqual([200, 200, 200, 200, 200])
    expect(res.every((r) => r.meta.cacheHit === true)).toBe(true)
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
    const s = sim(proxyGraph({ auth: 'jwt', cache: 'random', hitRate: 1, cacheablePaths: [] }, [['S1', undefined]]))
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

/** One client per path (each sends only that path) → P → S1 (catch-all) and S2 on /pagos. */
function edgeGraph(proxyConfig: Record<string, unknown>, paths: string[]): Graph {
  const clients = paths.map((p, i) => node(`C${i}`, 'client', { rate: 0, ...mixOf(p) }))
  return {
    nodes: [...clients, node('P', 'reverse-proxy', proxyConfig), node('S1', 'service'), node('S2', 'service')],
    edges: [...clients.map((c) => edge(c.id, 'P')), edge('P', 'S1'), edge('P', 'S2', prefix('/pagos'))],
  }
}

interface EdgeState {
  keys: { key: string }[]
  hits: number
  misses: number
}

describe('reverse proxy edge cache (cache-spec §5)', () => {
  /** Sends one request from client `i` and lets it finish. */
  const send = (s: Simulation, i: number) => {
    s.runAction(`C${i}`, 'send1')
    s.advance(3000)
  }

  it('cache off (default) never answers from the proxy, even for /static', () => {
    const s = sim(edgeGraph({}, ['/static/a']))
    const sent = sentFrom(s, 'P')
    for (let i = 0; i < 3; i++) send(s, 0)
    expect(sent).toHaveLength(3)
  })

  it('cacheable paths: only requests whose path starts with a prefix use the cache', () => {
    const s = sim(edgeGraph({ cache: 'random', hitRate: 1, cacheablePaths: ['/static', '/img'] }, ['/static/app.js', '/img/1', '/pagos/1', '/stat']))
    const sent = sentFrom(s, 'P')
    for (let i = 0; i < 4; i++) send(s, i)
    expect(sent.map((e) => e.msg.meta.path)).toEqual(['/pagos/1', '/stat'])
  })

  it('an empty cacheable list means every path', () => {
    const s = sim(edgeGraph({ cache: 'random', hitRate: 1, cacheablePaths: [] }, ['/static/a', '/pagos/1']))
    const sent = sentFrom(s, 'P')
    send(s, 0)
    send(s, 1)
    expect(sent).toHaveLength(0)
  })

  it('a missing cacheablePaths uses the default /static', () => {
    const s = sim(edgeGraph({ cache: 'random', hitRate: 1 }, ['/static/a', '/pagos/1']))
    const sent = sentFrom(s, 'P')
    send(s, 0)
    send(s, 1)
    expect(sent.map((e) => e.msg.meta.path)).toEqual(['/pagos/1'])
  })

  it('random hitRate 0 always routes and counts misses', () => {
    const s = sim(edgeGraph({ cache: 'random', hitRate: 0, cacheablePaths: [] }, ['/a']))
    const sent = sentFrom(s, 'P')
    for (let i = 0; i < 3; i++) send(s, 0)
    expect(sent).toHaveLength(3)
    expect(s.nodeState<EdgeState>('P')).toMatchObject({ hits: 0, misses: 3 })
  })

  it('keys: warm-up — the first request is a miss that routes, then hits answered at the proxy', () => {
    const s = sim(edgeGraph({ cache: 'keys', cacheablePaths: ['/static'] }, ['/static/a']))
    const sent = sentFrom(s, 'P')
    const res = clientResponses(s, 'C0')
    const labels: string[] = []
    s.on('node:label', (p) => labels.push(`${p.nodeId}:${p.text}`))
    for (let i = 0; i < 3; i++) send(s, 0)
    expect(sent).toHaveLength(1)
    expect(res.map((r) => [r.code, r.meta.cacheHit])).toEqual([
      [200, undefined],
      [200, true],
      [200, true],
    ])
    expect(labels.filter((l) => l.startsWith('P:'))).toEqual(['P:HIT', 'P:HIT'])
    const st = s.nodeState<EdgeState>('P')
    expect(st.keys.map((k) => k.key)).toEqual(['/static/a'])
    expect([st.hits, st.misses]).toEqual([2, 1])
    // The forwarded request is forgotten once its response went back.
    expect(s.nodeState<{ store: Record<string, string> }>('P').store).toEqual({})
  })

  it('keys: an error response is not stored', () => {
    const g = edgeGraph({ cache: 'keys', cacheablePaths: [] }, ['/a'])
    g.nodes = g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { up: false } } : n))
    const s = sim(g)
    const sent = sentFrom(s, 'P')
    send(s, 0)
    send(s, 0)
    expect(sent).toHaveLength(2)
    expect(s.nodeState<EdgeState>('P').keys).toEqual([])
  })

  it('keys: a non-cacheable path is never stored nor counted', () => {
    const s = sim(edgeGraph({ cache: 'keys', cacheablePaths: ['/static'] }, ['/pagos/1']))
    const sent = sentFrom(s, 'P')
    send(s, 0)
    send(s, 0)
    expect(sent).toHaveLength(2)
    expect(s.nodeState<EdgeState>('P')).toMatchObject({ keys: [], hits: 0, misses: 0 })
  })

  it('keys: LRU — capacity 2 evicts the least recently used key; a hit refreshes recency', () => {
    const s = sim(edgeGraph({ cache: 'keys', capacity: 2, cacheablePaths: [] }, ['/a', '/b', '/c']))
    const sent = sentFrom(s, 'P')
    send(s, 0) // miss a → [a]
    send(s, 1) // miss b → [a, b]
    send(s, 0) // hit a → [b, a]
    send(s, 2) // miss c → evicts b → [a, c]
    send(s, 0) // hit a
    send(s, 1) // miss b again
    expect(sent.map((e) => e.msg.meta.path)).toEqual(['/a', '/b', '/c', '/b'])
    expect(s.nodeState<EdgeState>('P').keys.map((k) => k.key)).toEqual(['/a', '/b'])
    expect(s.nodeState<EdgeState>('P').keys.length).toBeLessThanOrEqual(2)
  })

  it('keys: TTL — a key expires ttl ms after it was stored (sim time)', () => {
    const s = sim(edgeGraph({ cache: 'keys', ttl: 4000, cacheablePaths: [] }, ['/a']))
    const sent = sentFrom(s, 'P')
    send(s, 0) // miss, stored when the response passes back (< 3 s)
    send(s, 0) // within ttl → hit
    expect(sent).toHaveLength(1)
    s.advance(5000)
    send(s, 0) // expired → miss, routes again
    expect(sent).toHaveLength(2)
  })

  it('keys: lowering the capacity trims keys; turning the cache off clears them', () => {
    const g = edgeGraph({ cache: 'keys', capacity: 3, cacheablePaths: [] }, ['/a', '/b', '/c'])
    const s = sim(g)
    for (let i = 0; i < 3; i++) send(s, i)
    expect(s.nodeState<EdgeState>('P').keys).toHaveLength(3)
    const withConfig = (c: Record<string, unknown>): Graph => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'P' ? { ...n, config: { ...n.config, ...c } } : n)),
    })
    s.setGraph(withConfig({ capacity: 1 }))
    expect(s.nodeState<EdgeState>('P').keys.map((k) => k.key)).toEqual(['/c'])
    s.setGraph(withConfig({ cache: 'off' }))
    expect(s.nodeState<EdgeState>('P').keys).toEqual([])
  })

  it('narrowing the cacheable paths drops stored keys that no longer pass; a cache mode change resets hit/miss', () => {
    const g = edgeGraph({ cache: 'keys', cacheablePaths: [] }, ['/static/a', '/api/b'])
    const s = sim(g)
    send(s, 0)
    send(s, 1)
    send(s, 0)
    expect(s.nodeState<EdgeState>('P').keys.map((k) => k.key)).toEqual(['/api/b', '/static/a'])
    const withConfig = (c: Record<string, unknown>): Graph => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'P' ? { ...n, config: { ...n.config, ...c } } : n)),
    })
    s.setGraph(withConfig({ cacheablePaths: ['/static'] }))
    expect(s.nodeState<EdgeState>('P').keys.map((k) => k.key)).toEqual(['/static/a'])
    expect(s.nodeState<EdgeState>('P')).toMatchObject({ hits: 1, misses: 2 })
    s.setGraph(withConfig({ cacheablePaths: ['/static'], cache: 'random' }))
    expect(s.nodeState<EdgeState>('P')).toMatchObject({ hits: 0, misses: 0 })
  })

  it('order: the rate limit runs before the cache (a 429 is not a HIT)', () => {
    const s = sim(proxyGraph({ rateLimit: 1, cache: 'random', hitRate: 1, cacheablePaths: [] }, [['S1', undefined]], { burstSize: 2 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => r.code).sort()).toEqual([200, 429])
  })

  it('order: auth runs before the cache (a 401 is not a HIT)', () => {
    const s = sim(proxyGraph({ auth: 'credentials', cache: 'random', hitRate: 1, cacheablePaths: [] }, [['S1', undefined]], { auth: 'none' }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([401])
  })

  it('order: the cache runs before routing (a HIT for an unroutable path is still 200)', () => {
    const s = sim(proxyGraph({ cache: 'random', hitRate: 1, cacheablePaths: [] }, [['S1', prefix('/x')]], mixOf('/otra')))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([200])
  })

  it('keys + jwt: a miss stores the key and still issues the token; the next request hits with no new token needed', () => {
    const s = sim(proxyGraph({ auth: 'jwt', cache: 'keys', cacheablePaths: [] }, [['S1', undefined]], mixOf('/a')))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'send1')
    s.advance(3000)
    s.runAction('C', 'send1')
    s.advance(3000)
    expect(sent).toHaveLength(1)
    expect(res[0].meta.setSession).toBe(`jwt:${sent[0].msg.id}`)
    expect(res[1].code).toBe(200)
    expect(res[1].meta.cacheHit).toBe(true)
    expect(s.nodeState<{ issue: Record<string, true> }>('P').issue).toEqual({})
  })
})
