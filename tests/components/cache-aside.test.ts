import { describe, expect, it } from 'vitest'
import type { CacheState } from '../../src/components/cache'
import type { CacheAsideState } from '../../src/components/shared/cacheAside'
import { defaultRegistry } from '../../src/components/index'
import { Simulation } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

/*
 * Automatic cache-aside in a Servicio without behavior (docs/cache-spec.md §3).
 * C → S → K (leaf Cache) and D (Database).
 */

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { name: id, ...config },
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })

interface Opts {
  cache?: Record<string, unknown>
  db?: Record<string, unknown>
  service?: Record<string, unknown>
  /** Extra nodes/edges (e.g. to give the cache an output). */
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  /** Leave out the cache entirely. */
  noCache?: boolean
}

function setup(opts: Opts = {}) {
  const g: Graph = {
    nodes: [
      node('C', 'client', { mix: [{ value: '/a', weight: 1 }] }),
      node('S', 'service', { processingTime: 100, ...opts.service }),
      ...(opts.noCache ? [] : [node('K', 'cache', { processingTime: 50, ...opts.cache })]),
      node('D', 'database', { processingTime: 100, ...opts.db }),
      ...(opts.nodes ?? []),
    ],
    edges: [edge('C', 'S'), ...(opts.noCache ? [] : [edge('S', 'K')]), edge('S', 'D'), ...(opts.edges ?? [])],
  }
  const s = new Simulation(g, { seed: 3, registry: defaultRegistry })
  const responses: Message[] = []
  const arrivals: { at: string; msg: Message }[] = []
  s.on('message:arrived', (p) => {
    if (p.at === 'C' && p.msg.kind === 'response') responses.push(p.msg)
    if (p.msg.kind === 'request') arrivals.push({ at: p.at, msg: p.msg })
  })
  /** What reached K and D, in order: `K:get`, `K:set`, `K:-` (no cacheOp), `D`. */
  const log = () => arrivals.filter((a) => a.at === 'K' || a.at === 'D').map((a) => (a.at === 'D' ? 'D' : `K:${a.msg.meta.cacheOp ?? '-'}`))
  const send = () => {
    s.runAction('C', 'send1')
    s.advance(6000)
    return responses[responses.length - 1]
  }
  const pending = () => Object.keys(s.nodeState<CacheAsideState>('S').cachePending)
  /** The same graph without the cache. */
  const removeCache = () => s.setGraph({ nodes: g.nodes.filter((n) => n.id !== 'K'), edges: g.edges.filter((e) => e.target !== 'K') })
  return { s, responses, log, send, pending, removeCache, keys: () => s.nodeState<CacheState>('K').keys.map((k) => k.key) }
}

describe('Servicio: automatic cache-aside', () => {
  it('a miss calls the database, then sets the key, then replies 200', () => {
    const t = setup()
    const r = t.send()
    expect([r.status, r.code]).toEqual(['ok', 200])
    expect(t.log()).toEqual(['K:get', 'D', 'K:set'])
    expect(t.keys()).toEqual(['/a'])
    expect(t.s.nodeStats('D').ok).toBe(1)
    // A MISS is a normal answer: the cache counts no error.
    expect(t.s.nodeStats('K')).toMatchObject({ ok: 2, errors: 0 })
    expect(t.pending()).toEqual([])
  })

  it('the set is fire-and-forget: miss latency = get + database round trips only; the key is stored afterwards', () => {
    const t = setup()
    t.s.runAction('C', 'send1')
    // C→S 600, S 100, get 600+50+600, D 600+100+600, S→C 600 = 3850.
    t.s.advance(3849)
    expect(t.responses).toHaveLength(0)
    t.s.advance(1)
    expect(t.responses.map((r) => [r.code, t.s.now - r.createdAt])).toEqual([[200, 3850]])
    expect(t.keys()).toEqual([])
    t.s.advance(3000)
    expect(t.keys()).toEqual(['/a'])
    expect(t.pending()).toEqual([])
  })

  it('a cache deleted while the get is in flight: the database is called, 200, nothing pending', () => {
    const t = setup()
    t.s.runAction('C', 'send1')
    t.s.advance(1000) // the get travels to K (arrives at 1300)
    t.removeCache()
    t.s.advance(6000)
    expect(t.responses.map((r) => r.code)).toEqual([200])
    expect(t.s.nodeStats('D').ok).toBe(1)
    expect(t.pending()).toEqual([])
  })

  it('a cache deleted after the get answered: 200, no set sent, nothing pending', () => {
    const t = setup()
    t.s.runAction('C', 'send1')
    t.s.advance(2200) // the MISS came back at 1950; the database call is in flight
    t.removeCache()
    t.s.advance(6000)
    expect(t.responses.map((r) => r.code)).toEqual([200])
    expect(t.log()).toEqual(['K:get', 'D'])
    expect(t.pending()).toEqual([])
  })

  it('a hit replies 200 without calling the database', () => {
    const t = setup()
    t.send()
    const r = t.send()
    expect([r.status, r.code]).toEqual(['ok', 200])
    expect(t.log()).toEqual(['K:get', 'D', 'K:set', 'K:get'])
    expect(t.s.nodeStats('D').ok).toBe(1)
  })

  it('a database failure replies 502 and never sets the key', () => {
    const t = setup({ db: { up: false } })
    const r = t.send()
    expect([r.status, r.code]).toEqual(['error', 502])
    expect(t.log()).toEqual(['K:get', 'D'])
    expect(t.keys()).toEqual([])
  })

  it('a down cache is ignored: the database is still called and nothing is set', () => {
    const t = setup({ cache: { up: false } })
    const r = t.send()
    expect([r.status, r.code]).toEqual(['ok', 200])
    expect(t.log()).toEqual(['K:get', 'D'])
    expect(t.s.nodeStats('D').ok).toBe(1)
  })

  it('random mode cache: a miss goes to the database (set is harmless)', () => {
    const t = setup({ cache: { mode: 'random', hitRate: 0 } })
    expect(t.send().code).toBe(200)
    expect(t.log()).toEqual(['K:get', 'D', 'K:set'])
  })

  it('sequential mode still uses the cache first', () => {
    const t = setup({ service: { mode: 'sequential' } })
    t.send()
    t.send()
    expect(t.log()).toEqual(['K:get', 'D', 'K:set', 'K:get'])
  })

  it('without a leaf cache the service is unchanged: a read-through cache is just another output', () => {
    const t = setup({ nodes: [node('D2', 'database', { processingTime: 100 })], edges: [edge('K', 'D2')] })
    const r = t.send()
    expect([r.status, r.code]).toEqual(['ok', 200])
    // K gets a plain request (no cacheOp) in parallel with D, as any dependency.
    expect(t.log().sort()).toEqual(['D', 'K:-'])
    expect(t.s.nodeStats('D2').ok).toBe(1)
  })

  it('without any cache the service is unchanged', () => {
    const t = setup({ noCache: true })
    expect(t.send().code).toBe(200)
    expect(t.log()).toEqual(['D'])
  })

  it('only the leaf cache gets cacheOp requests; other outputs are called on a miss', () => {
    const t = setup({ nodes: [node('T', 'service', { processingTime: 100 })], edges: [edge('S', 'T')] })
    t.send()
    expect(t.s.nodeStats('T').ok).toBe(1)
    t.send()
    expect(t.s.nodeStats('T').ok).toBe(1)
  })
})
