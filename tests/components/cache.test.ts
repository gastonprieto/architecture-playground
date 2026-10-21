import { describe, expect, it } from 'vitest'
import { cacheKeyOf, cacheLookup, cacheStore, type CacheEntry, type CacheState } from '../../src/components/cache'
import { defaultRegistry } from '../../src/components/index'
import { targetCapacity } from '../../src/components/shared/push'
import { Registry, defineComponent } from '../../src/engine/registry'
import { HOP_MS, Simulation } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })

/** Sends the queued metas (one per `send` action) to its first output and records the responses. */
const probe = defineComponent<Record<string, never>, { outbox: Message['meta'][]; responses: Message[] }>({
  type: 'probe',
  label: 'Probe',
  icon: 'p',
  color: 'req',
  config: {},
  initialState: () => ({ outbox: [], responses: [] }),
  onMessage() {},
  onResponse(res, ctx) {
    ctx.state.responses.push(res)
  },
  actions: {
    /** Records targetCapacity of its first output (push-based senders use it). */
    capacity: {
      label: 'Capacity',
      run(ctx) {
        ctx.state.responses.push({ id: 'cap', kind: 'response', meta: { cap: targetCapacity(ctx, ctx.outputs()[0].target) }, trail: [], createdAt: 0 })
      },
    },
    send: {
      label: 'Send',
      run(ctx) {
        const meta = ctx.state.outbox.shift() ?? {}
        ctx.send(ctx.outputs()[0].target, ctx.newMessage('request', meta))
      },
    },
  },
})

const registry = new Registry()
for (const d of defaultRegistry.list()) registry.register(d)
registry.register(probe)

/** P → K (cache) [→ D (database)]. */
function setup(cache: Record<string, unknown> = {}, withDb = false, db: Record<string, unknown> = {}) {
  const g: Graph = {
    nodes: [node('P', 'probe'), node('K', 'cache', cache), ...(withDb ? [node('D', 'database', { processingTime: 100, ...db })] : [])],
    edges: [edge('P', 'K'), ...(withDb ? [edge('K', 'D')] : [])],
  }
  const s = new Simulation(g, { seed: 7, registry })
  const labels: string[] = []
  s.on('node:label', (p) => labels.push(`${p.text}:${p.tone}`))
  const state = () => s.nodeState<{ outbox: Message['meta'][]; responses: Message[] }>('P')
  /** Sends one request with `meta` and lets it finish. */
  const send = (meta: Message['meta'], wait = 5000) => {
    state().outbox.push(meta)
    s.runAction('P', 'send')
    s.advance(wait)
    const r = state().responses
    return r[r.length - 1]
  }
  const keys = () => s.nodeState<CacheState>('K').keys.map((k) => k.key)
  return { s, g, labels, send, keys, cacheState: () => s.nodeState<CacheState>('K') }
}

const brief = (m: Message) => ({ status: m.status, code: m.code, hit: m.meta.cacheHit })

describe('cache: catalog', () => {
  it('has catalog metadata and config with conditional fields', () => {
    const d = defaultRegistry.get('cache')!
    expect([d.label, d.icon, d.color]).toEqual(['Cache', '⚡', 'redis'])
    expect(d.config.mode).toMatchObject({ type: 'select', default: 'keys' })
    expect(d.config.mode.type === 'select' && d.config.mode.options.map((o) => o.value)).toEqual(['keys', 'random'])
    expect(d.config.capacity).toMatchObject({ type: 'number', default: 50, min: 1, max: 1000, showIf: { field: 'mode', equals: 'keys' } })
    expect(d.config.ttl).toMatchObject({ type: 'number', default: 0, min: 0, max: 600000, showIf: { field: 'mode', equals: 'keys' } })
    expect(d.config.hitRate).toMatchObject({ type: 'number', default: 0.8, min: 0, max: 1, showIf: { field: 'mode', equals: 'random' } })
    expect(d.config.processingTime).toMatchObject({ type: 'number', default: 50 })
    expect(d.config.up).toMatchObject({ type: 'boolean', default: true })
    expect(d.config.queueMax).toBeUndefined()
  })
})

describe('cache: pure helpers', () => {
  it('cacheKeyOf: cacheKey, then path, then /', () => {
    expect(cacheKeyOf({ cacheKey: 'k', path: '/a' })).toBe('k')
    expect(cacheKeyOf({ path: '/a' })).toBe('/a')
    expect(cacheKeyOf({})).toBe('/')
    expect(cacheKeyOf({ cacheKey: '', path: '' })).toBe('/')
  })

  it('store + lookup: LRU eviction refreshed by hits, TTL from the store time', () => {
    const e: CacheEntry[] = []
    cacheStore(e, 'a', 0, 2, 0)
    cacheStore(e, 'b', 1, 2, 0)
    expect(cacheLookup(e, 'a', 2, 0)).toBe(true) // a is now the most recent
    cacheStore(e, 'c', 3, 2, 0) // evicts b
    expect(e.map((x) => x.key).sort()).toEqual(['a', 'c'])
    expect(cacheLookup(e, 'b', 4, 0)).toBe(false)
    // TTL 10: stored at 3, expires at 13.
    expect(cacheLookup(e, 'c', 12, 10)).toBe(true)
    expect(cacheLookup(e, 'c', 13, 10)).toBe(false)
    expect(e.map((x) => x.key)).not.toContain('c')
  })

  it('a set of an existing key refreshes it without growing', () => {
    const e: CacheEntry[] = []
    cacheStore(e, 'a', 0, 2, 0)
    cacheStore(e, 'b', 1, 2, 0)
    cacheStore(e, 'a', 2, 2, 0)
    cacheStore(e, 'c', 3, 2, 0) // evicts b, the least recently used
    expect(e.map((x) => x.key).sort()).toEqual(['a', 'c'])
  })

  it('never exceeds a lowered capacity', () => {
    const e: CacheEntry[] = []
    for (let i = 0; i < 5; i++) cacheStore(e, `k${i}`, i, 5, 0)
    cacheStore(e, 'k9', 10, 2, 0)
    expect(e.map((x) => x.key)).toEqual(['k4', 'k9'])
  })
})

describe('cache: leaf (no outputs)', () => {
  it('get on an empty cache is a MISS: 200 with cacheHit false, not an error', () => {
    const t = setup()
    expect(brief(t.send({ cacheOp: 'get', path: '/a' }))).toEqual({ status: 'ok', code: 200, hit: false })
    expect(t.labels).toEqual(['MISS:slow'])
    expect(t.cacheState().misses).toBe(1)
    expect(t.s.nodeStats('K')).toMatchObject({ ok: 1, errors: 0 })
  })

  it('set then get hits (keyed by path); a request without cacheOp is a get', () => {
    const t = setup()
    expect(brief(t.send({ cacheOp: 'set', path: '/a' }))).toMatchObject({ status: 'ok', code: 200 })
    expect(t.keys()).toEqual(['/a'])
    expect(brief(t.send({ cacheOp: 'get', path: '/a' }))).toEqual({ status: 'ok', code: 200, hit: true })
    expect(brief(t.send({ path: '/a' }))).toEqual({ status: 'ok', code: 200, hit: true })
    expect(brief(t.send({ path: '/b' }))).toEqual({ status: 'ok', code: 200, hit: false })
    expect(t.labels).toEqual(['HIT:redis', 'HIT:redis', 'MISS:slow'])
    expect([t.cacheState().hits, t.cacheState().misses]).toEqual([2, 1])
  })

  it('cacheKey wins over path', () => {
    const t = setup()
    t.send({ cacheOp: 'set', cacheKey: 'x', path: '/a' })
    expect(t.keys()).toEqual(['x'])
    expect(t.send({ cacheOp: 'get', path: '/a' }).meta.cacheHit).toBe(false)
    expect(t.send({ cacheOp: 'get', cacheKey: 'x', path: '/zzz' }).meta.cacheHit).toBe(true)
  })

  it('LRU at capacity: the least recently used key leaves; a get hit refreshes recency', () => {
    const t = setup({ capacity: 2 })
    t.send({ cacheOp: 'set', path: '/a' })
    t.send({ cacheOp: 'set', path: '/b' })
    expect(t.send({ cacheOp: 'get', path: '/a' }).meta.cacheHit).toBe(true)
    t.send({ cacheOp: 'set', path: '/c' })
    expect(t.keys().sort()).toEqual(['/a', '/c'])
    expect(t.send({ cacheOp: 'get', path: '/b' }).meta.cacheHit).toBe(false)
    expect(t.send({ cacheOp: 'get', path: '/a' }).meta.cacheHit).toBe(true)
  })

  it('lowering the capacity trims the stored keys right away', () => {
    const t = setup({ capacity: 3 })
    for (const p of ['/a', '/b', '/c']) t.send({ cacheOp: 'set', path: p })
    t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'K' ? { ...n, config: { capacity: 1 } } : n)) })
    expect(t.keys()).toEqual(['/c'])
  })

  it('changing the mode resets the hit/miss counters', () => {
    const t = setup()
    t.send({ cacheOp: 'set', path: '/a' })
    t.send({ cacheOp: 'get', path: '/a' })
    t.send({ cacheOp: 'get', path: '/b' })
    expect([t.cacheState().hits, t.cacheState().misses]).toEqual([1, 1])
    const withK = (c: Record<string, unknown>) => t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'K' ? { ...n, config: c } : n)) })
    withK({ mode: 'keys', capacity: 10 })
    expect([t.cacheState().hits, t.cacheState().misses]).toEqual([1, 1])
    withK({ mode: 'random' })
    expect([t.cacheState().hits, t.cacheState().misses]).toEqual([0, 0])
  })

  it('Activo off forgets every key (like a restarted Redis), also while paused; idempotent', () => {
    const t = setup()
    t.send({ cacheOp: 'set', path: '/a' })
    expect(t.keys()).toEqual(['/a'])
    const withK = (c: Record<string, unknown>) => t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'K' ? { ...n, config: c } : n)) })
    withK({ up: false })
    expect(t.keys()).toEqual([])
    withK({ up: false })
    t.s.advance(1000)
    expect(t.keys()).toEqual([])
    withK({ up: true })
    expect(t.send({ cacheOp: 'get', path: '/a' }).meta.cacheHit).toBe(false)
  })

  it('a key that arrives while down (read-through response) is dropped on the next tick', () => {
    const t = setup()
    t.s.nodeState<CacheState>('K').keys.push({ key: '/x', at: 0 })
    const withK = (c: Record<string, unknown>) => t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'K' ? { ...n, config: c } : n)) })
    withK({ up: false })
    t.s.nodeState<CacheState>('K').keys.push({ key: '/late', at: 0 })
    t.s.advance(200)
    expect(t.keys()).toEqual([])
  })

  it('TTL is measured in sim time: an expired key is a MISS and is removed', () => {
    const t = setup({ ttl: 3000 })
    const RT = 2 * HOP_MS + 50 // one round trip: 1250 ms
    t.send({ cacheOp: 'set', path: '/a' }, RT) // stored at 650
    expect(t.send({ cacheOp: 'get', path: '/a' }, RT).meta.cacheHit).toBe(true) // looked up at 1900
    expect(t.keys()).toEqual(['/a'])
    t.s.advance(1000)
    expect(t.send({ cacheOp: 'get', path: '/a' }, RT).meta.cacheHit).toBe(false) // looked up at 4150 ≥ 650 + 3000
    expect(t.keys()).toEqual([])
  })

  it('TTL 0 never expires', () => {
    const t = setup()
    t.send({ cacheOp: 'set', path: '/a' })
    t.s.advance(1_000_000)
    expect(t.send({ cacheOp: 'get', path: '/a' }).meta.cacheHit).toBe(true)
  })

  it('random mode: hitRate decides, set stores nothing', () => {
    const hit = setup({ mode: 'random', hitRate: 1 })
    expect(brief(hit.send({ cacheOp: 'set', path: '/a' }))).toMatchObject({ status: 'ok', code: 200 })
    expect(hit.keys()).toEqual([])
    expect(brief(hit.send({ cacheOp: 'get', path: '/never-set' }))).toEqual({ status: 'ok', code: 200, hit: true })
    const miss = setup({ mode: 'random', hitRate: 0 })
    miss.send({ cacheOp: 'set', path: '/a' })
    expect(brief(miss.send({ cacheOp: 'get', path: '/a' }))).toEqual({ status: 'ok', code: 200, hit: false })
  })

  it('down → 503 (Activo off)', () => {
    const t = setup({ up: false })
    expect(brief(t.send({ cacheOp: 'get', path: '/a' }))).toMatchObject({ status: 'error', code: 503 })
  })

  it('the key capacity is not a concurrency limit: a burst never queues', () => {
    const t = setup({ capacity: 1 })
    for (let i = 0; i < 5; i++) {
      t.s.nodeState<{ outbox: Message['meta'][] }>('P').outbox.push({ cacheOp: 'get', path: `/${i}` })
      t.s.runAction('P', 'send')
    }
    t.s.advance(HOP_MS + 1)
    expect(t.s.nodeStats('K')).toMatchObject({ inFlight: 5, queued: 0 })
  })
})

describe('cache: read-through (with outputs)', () => {
  it('keys mode: a miss forwards; the ok response stores the key; the next get is a HIT answered by the cache', () => {
    const t = setup({}, true)
    const first = t.send({ path: '/a' })
    expect(brief(first)).toEqual({ status: 'ok', code: 200, hit: false })
    expect(t.s.nodeStats('D').ok).toBe(1)
    expect(t.keys()).toEqual(['/a'])
    expect(brief(t.send({ path: '/a' }))).toEqual({ status: 'ok', code: 200, hit: true })
    expect(t.s.nodeStats('D').ok).toBe(1)
    expect(t.labels).toEqual(['MISS:slow', 'HIT:redis'])
  })

  it('an error response is not stored', () => {
    const t = setup({}, true, { up: false })
    expect(t.send({ path: '/a' }).code).toBe(503)
    expect(t.keys()).toEqual([])
  })

  it('random mode keeps the old behavior: hitRate 1 never reaches the DB, hit latency is 2 hops + 50 ms', () => {
    const t = setup({ mode: 'random', hitRate: 1 }, true)
    expect(t.send({ path: '/a' }).code).toBe(200)
    expect(t.s.nodeStats('D').ok).toBe(0)
    const p = setup({ mode: 'random', hitRate: 1 }, true)
    p.s.nodeState<{ outbox: Message['meta'][] }>('P').outbox.push({ path: '/a' })
    p.s.runAction('P', 'send')
    p.s.advance(2 * HOP_MS + 49)
    expect(p.s.nodeState<{ responses: Message[] }>('P').responses).toHaveLength(0)
    p.s.advance(1)
    expect(p.s.nodeState<{ responses: Message[] }>('P').responses).toHaveLength(1)
  })

  it('random mode hitRate 0: everything reaches the DB, nothing is stored', () => {
    const t = setup({ mode: 'random', hitRate: 0 }, true)
    t.send({ path: '/a' })
    t.send({ path: '/a' })
    expect(t.s.nodeStats('D').ok).toBe(2)
    expect(t.keys()).toEqual([])
    expect(t.labels).toEqual(['MISS:slow', 'MISS:slow'])
  })

  it('a set in read-through stores without forwarding', () => {
    const t = setup({}, true)
    expect(t.send({ cacheOp: 'set', path: '/a' }).code).toBe(200)
    expect(t.s.nodeStats('D').ok).toBe(0)
    expect(t.keys()).toEqual(['/a'])
  })
})

describe('cache: read-through forwarding and push slots', () => {
  it('strips cacheOp before forwarding downstream', () => {
    const t = setup({}, true)
    const atD: Message[] = []
    t.s.on('message:arrived', (p) => {
      if (p.at === 'D' && p.msg.kind === 'request') atD.push(p.msg)
    })
    t.send({ cacheOp: 'get', path: '/a' })
    expect(atD).toHaveLength(1)
    expect(atD[0].meta.cacheOp).toBeUndefined()
    expect(atD[0].meta.path).toBe('/a')
  })

  it('push-based senders see 1 slot for a Cache, not its key capacity', () => {
    const t = setup({ capacity: 50 })
    t.s.runAction('P', 'capacity')
    const r = t.s.nodeState<{ responses: Message[] }>('P').responses
    expect(r[r.length - 1].meta.cap).toBe(1)
  })
})
