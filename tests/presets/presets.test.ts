import { describe, expect, it } from 'vitest'
import { compileBehavior } from '../../src/components/behavior'
import { defaultRegistry } from '../../src/components/index'
import { Simulation } from '../../src/engine/simulation'
import type { Message } from '../../src/engine/types'
import { parseGraph, serializeGraph } from '../../src/persistence/serialize'
import { getPresets, withDemoTraffic } from '../../src/presets'
import { CLIENT_COLORS } from '../../src/ui/colors'
import type { Graph } from '../../src/engine/types'
import type { CacheState } from '../../src/components/cache'
import { prepareGraph } from '../../src/ui/graphEntry'

// Behavior is checked on the Spanish presets; the English ones only differ in texts.
const presets = getPresets('es')

const preset = (id: string) => presets.find((p) => p.id === id)!
const run = (id: string) => {
  const sim = new Simulation(withDemoTraffic(preset(id)), { seed: 1, registry: defaultRegistry })
  return sim
}

/** Responses arriving at each client node, grouped by client id. */
function responsesByClient(sim: Simulation): Record<string, Message[]> {
  const out: Record<string, Message[]> = {}
  sim.on('message:arrived', (p) => {
    if (p.msg.kind === 'response') (out[p.at] ??= []).push(p.msg)
  })
  return out
}

describe('presets', () => {
  it('exposes the seven presets with valid, uniquely-id graphs', () => {
    expect(presets.map((p) => p.id)).toEqual(['load-balancer', 'sessions', 'sync-vs-queue', 'pubsub', 'reverse-proxy', 'cache', 'purchase-order'])
    for (const p of presets) {
      const ids = p.graph.nodes.map((n) => n.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const n of p.graph.nodes) expect(defaultRegistry.get(n.type)).toBeDefined()
      for (const e of p.graph.edges) {
        expect(ids).toContain(e.source)
        expect(ids).toContain(e.target)
      }
    }
  })

  it('load-balancer: no errors and every server gets traffic', () => {
    const sim = run('load-balancer')
    sim.advance(30_000)
    expect(sim.metrics().errorRate).toBe(0)
    for (const id of ['srv-1', 'srv-2', 'srv-3']) expect(sim.nodeStats(id).ok).toBeGreaterThan(0)
  })

  it('sync-vs-queue: sync lane gets 503s, queue lane gets only 202s', () => {
    const sim = run('sync-vs-queue')
    const byClient = responsesByClient(sim)
    sim.advance(30_000)
    const sync = byClient['client-sync']
    const queued = byClient['client-queue']
    expect(sync.some((m) => m.code === 503)).toBe(true)
    expect(queued.length).toBeGreaterThan(0)
    expect(queued.filter((m) => m.status === 'error')).toHaveLength(0)
    expect(queued.every((m) => m.code === 202)).toBe(true)
  })

  it('pubsub: all subscribers process events; slow Analytics lags behind Stock', () => {
    const sim = run('pubsub')
    sim.advance(30_000)
    for (const id of ['facturacion', 'stock', 'mails', 'analytics']) expect(sim.nodeStats(id).ok).toBeGreaterThan(0)
    const lanes = (sim.nodeState('broker') as { lanes: Record<string, unknown[]> }).lanes
    const len = (id: string) => (lanes[id] ?? []).length
    for (const id of ['facturacion', 'stock', 'mails']) expect(len(id)).toBeLessThanOrEqual(2)
    expect(len('analytics')).toBeGreaterThan(5)
  })

  it('reverse-proxy: routes by path prefix', () => {
    const sim = run('reverse-proxy')
    const paths: Record<string, string[]> = {}
    sim.on('message:arrived', (p) => {
      if (p.msg.kind === 'request' && ['usuarios', 'ordenes', 'pagos', 'web'].includes(p.at)) (paths[p.at] ??= []).push(p.msg.meta.path ?? '')
    })
    sim.advance(30_000)
    expect(paths['usuarios'].length).toBeGreaterThan(0)
    expect(paths['usuarios'].every((x) => x.startsWith('/usuarios'))).toBe(true)
    expect(paths['ordenes'].every((x) => x.startsWith('/ordenes'))).toBe(true)
    expect(paths['pagos'].every((x) => x.startsWith('/pagos'))).toBe(true)
    expect(paths['web'].length).toBeGreaterThan(0)
    expect(paths['web'].every((x) => x === '/static')).toBe(true)
  })

  it('every preset client starts idle (0 req/s) and has a demo rate to start the traffic with', () => {
    for (const p of presets) {
      const clients = p.graph.nodes.filter((x) => x.type === 'client')
      for (const n of clients) {
        expect(n.config.rate, `${p.id}/${n.id}`).toBe(0)
        expect(p.demoRates[n.id], `${p.id}/${n.id}`).toBeGreaterThan(0)
      }
      expect(Object.keys(p.demoRates).sort()).toEqual(clients.map((n) => n.id).sort())
    }
  })

  it('every preset client has a distinct palette color', () => {
    for (const p of presets) {
      const colors = p.graph.nodes.filter((n) => n.type === 'client').map((n) => n.config.color)
      for (const c of colors) expect(CLIENT_COLORS).toContain(c)
      expect(new Set(colors).size).toBe(colors.length)
    }
  })

  it('every preset client has an explicit, unique IP', () => {
    for (const p of presets) {
      const ips = p.graph.nodes.filter((n) => n.type === 'client').map((n) => n.config.ip)
      for (const ip of ips) expect(ip).toMatch(/^10\.0\.0\.\d+$/)
      expect(new Set(ips).size).toBe(ips.length)
    }
  })

  it('load-balancer: with ip-hash, the two clients hash to different servers', () => {
    const p = preset('load-balancer')
    const traffic = withDemoTraffic(p)
    const graph = { ...traffic, nodes: traffic.nodes.map((n) => (n.id === 'lb' ? { ...n, config: { ...n.config, algorithm: 'ip-hash' } } : n)) }
    const sim = new Simulation(graph, { seed: 1, registry: defaultRegistry })
    const targets: Record<string, Set<string>> = {}
    sim.on('message:sent', (e) => {
      if (e.from === 'lb' && e.msg.kind === 'request') (targets[e.msg.meta.clientId!] ??= new Set()).add(e.to)
    })
    sim.advance(10_000)
    expect([...targets['web']]).toEqual(['srv-3'])
    expect([...targets['mobile']]).toEqual(['srv-1'])
  })

  it('every preset survives parseGraph(serializeGraph(g))', () => {
    for (const p of presets) expect(parseGraph(serializeGraph(p.graph))).toEqual({ ok: true, graph: p.graph })
  })

  it('builds the same graphs in English, with translated names, descriptions and node names', () => {
    const enPresets = getPresets('en')
    expect(enPresets.map((p) => p.id)).toEqual(presets.map((p) => p.id))
    const names = enPresets.flatMap((p) => p.graph.nodes.map((n) => n.config.name))
    for (const name of ['Browser', 'Mobile app', 'Server 1', 'Database', 'Orders', 'Billing', 'Inventory', 'Emails', 'Analytics', 'Users', 'Payments', 'Web'])
      expect(names).toContain(name)
    expect(enPresets.map((p) => p.name)).toEqual(['Load Balancer', 'Sessions', 'Sync vs queue', 'Pub/sub', 'Reverse Proxy', 'Cache', 'Purchase order'])
    expect(enPresets.find((p) => p.id === 'sync-vs-queue')!.description).toMatch(/^The same traffic/)
    for (const [i, p] of enPresets.entries()) {
      const es = presets[i]
      // Same topology and ids; only texts (names, paths, event types) change.
      expect(p.graph.nodes.map((n) => [n.id, n.type, n.position])).toEqual(es.graph.nodes.map((n) => [n.id, n.type, n.position]))
      expect(p.graph.edges.map((e) => e.id)).toEqual(es.graph.edges.map((e) => e.id))
    }
  })

  it('node names of single-instance infrastructure match the type labels (title case)', () => {
    for (const lang of ['es', 'en'] as const) {
      const names = getPresets(lang).flatMap((p) => p.graph.nodes.map((n) => n.config.name))
      expect(names).toContain('Load Balancer')
      expect(names).toContain('Reverse Proxy')
    }
  })

  it('the Spanish presets keep their Spanish names', () => {
    const names = presets.flatMap((p) => p.graph.nodes.map((n) => n.config.name))
    for (const name of ['Navegador', 'App móvil', 'Servidor 1', 'Base de datos', 'Órdenes', 'Facturación', 'Usuarios', 'Pagos'])
      expect(names).toContain(name)
  })

  it('reverse-proxy in English routes /users, /orders and /payments', () => {
    const p = getPresets('en').find((x) => x.id === 'reverse-proxy')!
    const sim = new Simulation(withDemoTraffic(p), { seed: 1, registry: defaultRegistry })
    const paths: Record<string, string[]> = {}
    sim.on('message:arrived', (e) => {
      if (e.msg.kind === 'request') (paths[e.at] ??= []).push(e.msg.meta.path ?? '')
    })
    sim.advance(30_000)
    expect(paths['usuarios'].every((x) => x.startsWith('/users'))).toBe(true)
    expect(paths['ordenes'].every((x) => x.startsWith('/orders'))).toBe(true)
    expect(paths['pagos'].every((x) => x.startsWith('/payments'))).toBe(true)
  })
})

/** Outputs of a node the way the engine builds them: deduped by target, trimmed name and type. */
function outputsOf(graph: Graph, id: string) {
  const targets = [...new Set(graph.edges.filter((e) => e.source === id).map((e) => e.target))]
  return targets.map((t) => {
    const n = graph.nodes.find((x) => x.id === t)!
    return { name: String(n.config.name).trim(), type: n.type }
  })
}

describe('purchase-order preset', () => {
  const ORCH_DSL = ['ordenes-orq', 'stock-orq', 'pagos-orq', 'mails-orq']
  const CHOR_DSL = ['ordenes-cor', 'stock-cor', 'pagos-cor', 'mails-cor']

  it.each(['es', 'en'] as const)('every DSL compiles with zero errors and at least one handler (%s)', (lang) => {
    const p = getPresets(lang).find((x) => x.id === 'purchase-order')!
    const withDsl = p.graph.nodes.filter((n) => typeof n.config.behavior === 'string' && n.config.behavior.trim() !== '')
    expect(withDsl.map((n) => n.id).sort()).toEqual([...ORCH_DSL, ...CHOR_DSL].sort())
    for (const n of withDsl) {
      const { program, errors } = compileBehavior(n.config.behavior as string, outputsOf(p.graph, n.id))
      expect(errors, `${lang}/${n.id}`).toEqual([])
      expect(program.handlers.length, `${lang}/${n.id}`).toBeGreaterThan(0)
    }
  })

  it('names and DSL follow the language', () => {
    const es = getPresets('es').find((x) => x.id === 'purchase-order')!
    const en = getPresets('en').find((x) => x.id === 'purchase-order')!
    expect(es.name).toBe('Orden de compra')
    expect(en.name).toBe('Purchase order')
    const cfg = (p: typeof es, id: string) => p.graph.nodes.find((n) => n.id === id)!.config
    expect(cfg(es, 'ordenes-orq').behavior).toContain('on request /ordenes:')
    expect(cfg(es, 'ordenes-orq').behavior).toContain('call Pagos /cobros or reply 402')
    expect(cfg(es, 'ordenes-cor').behavior).toContain('publish OrdenCreada')
    expect(cfg(en, 'ordenes-orq').behavior).toContain('on request /orders:')
    expect(cfg(en, 'ordenes-orq').behavior).toContain('call Payments /charges or reply 402')
    expect(cfg(en, 'ordenes-cor').behavior).toContain('publish OrderCreated')
    expect(cfg(en, 'stock-cor').behavior).toContain('on event OrderCreated:')
    expect(cfg(en, 'stock-cor').behavior).toContain('query "Inventory DB"')
    expect(cfg(es, 'client-orq').mix).toEqual([{ value: '/ordenes', weight: 1 }])
    expect(cfg(en, 'client-cor').mix).toEqual([{ value: '/orders', weight: 1 }])
  })

  it.each(['es', 'en'] as const)('30 s: orchestration answers 201, choreography 202, every subscriber processed events (%s)', (lang) => {
    const p = getPresets(lang).find((x) => x.id === 'purchase-order')!
    const sim = new Simulation(withDemoTraffic(p), { seed: 1, registry: defaultRegistry })
    const byClient = responsesByClient(sim)
    sim.advance(30_000)
    const orch = byClient['client-orq'] ?? []
    const chor = byClient['client-cor'] ?? []
    expect(orch.filter((m) => m.code === 201).length).toBeGreaterThan(20)
    expect(orch.every((m) => m.code === 201 || m.code === 402)).toBe(true)
    expect(chor.filter((m) => m.code === 202).length).toBeGreaterThan(20)
    expect(chor.every((m) => m.code === 202)).toBe(true)
    for (const id of ['stock-cor', 'pagos-cor', 'mails-cor']) expect(sim.nodeStats(id).ok, id).toBeGreaterThan(20)
    for (const id of ['db-stock-orq', 'db-pagos-orq', 'db-mails-orq', 'db-ordenes-cor', 'db-stock-cor', 'db-pagos-cor', 'db-mails-cor'])
      expect(sim.nodeStats(id).ok, id).toBeGreaterThan(0)
  })
})

/** Every DSL of a preset compiles against its outputs (the engine's view), with at least one handler. */
function expectDslsCompile(p: { graph: Graph }, label: string) {
  for (const n of p.graph.nodes.filter((x) => typeof x.config.behavior === 'string' && x.config.behavior.trim() !== '')) {
    const { program, errors } = compileBehavior(n.config.behavior as string, outputsOf(p.graph, n.id))
    expect(errors, `${label}/${n.id}`).toEqual([])
    expect(program.handlers.length, `${label}/${n.id}`).toBeGreaterThan(0)
  }
}

describe('sessions preset', () => {
  const LANES = { mem: 'client-mem', store: 'client-store', jwt: 'client-jwt' } as const
  const WARM_UP = 8_000

  it('three lanes: 5 users with login, round robin without sticky, 3 servers each; a key-value store', () => {
    const p = preset('sessions')
    const cfg = (id: string) => p.graph.nodes.find((n) => n.id === id)!.config
    for (const lane of ['mem', 'store', 'jwt']) {
      expect(cfg(`client-${lane}`)).toMatchObject({ users: 5, auth: 'login', rate: 0 })
      expect(cfg(`lb-${lane}`)).toMatchObject({ algorithm: 'round-robin', sticky: false, healthChecks: true })
      for (const i of [1, 2, 3]) expect(p.graph.edges.some((e) => e.source === `lb-${lane}` && e.target === `${lane}-${i}`)).toBe(true)
    }
    expect(cfg('mem-1').behavior).toContain('session memory')
    expect(cfg('store-1').behavior).toContain('session Sesiones')
    expect(cfg('jwt-1').behavior).toContain('session jwt')
    expect(cfg('sessions-db')).toMatchObject({ name: 'Sesiones', kind: 'key-value', processingTime: 20 })
    expect(getPresets('en').find((x) => x.id === 'sessions')!.graph.nodes.find((n) => n.id === 'sessions-db')!.config.name).toBe('Sessions')
  })

  it.each(['es', 'en'] as const)('every DSL compiles (%s)', (lang) => {
    const p = getPresets(lang).find((x) => x.id === 'sessions')!
    expectDslsCompile(p, lang)
    expect(p.graph.nodes.filter((n) => n.config.behavior).length).toBe(9)
  })

  it('30 s: the memory lane loses sessions; the store and jwt lanes do not after warm-up', () => {
    const sim = run('sessions')
    const lost: Record<string, number> = {}
    const ok: Record<string, number> = {}
    sim.on('message:arrived', (e) => {
      if (e.msg.kind !== 'response' || sim.now < WARM_UP) return
      if (e.msg.code === 401 && e.msg.meta.authError === 'session-lost') lost[e.at] = (lost[e.at] ?? 0) + 1
      if (e.msg.status === 'ok') ok[e.at] = (ok[e.at] ?? 0) + 1
    })
    sim.advance(30_000)
    expect(lost[LANES.mem] ?? 0).toBeGreaterThan(5)
    expect(lost[LANES.store] ?? 0).toBe(0)
    expect(lost[LANES.jwt] ?? 0).toBe(0)
    for (const id of Object.values(LANES)) expect(ok[id] ?? 0, id).toBeGreaterThan(5)
    // Each user's next request leaves after its login cookie came back: one stored session per user.
    expect((sim.nodeState('sessions-db') as { sessions: string[] }).sessions).toHaveLength(5)
  })

  it('sticky on and a memory server off: its users get one session-lost 401, log in elsewhere, no lasting 503s', () => {
    const p = preset('sessions')
    const traffic = withDemoTraffic(p)
    const sticky = { ...traffic, nodes: traffic.nodes.map((n) => (n.id === 'lb-mem' ? { ...n, config: { ...n.config, sticky: true } } : n)) }
    const sim = new Simulation(sticky, { seed: 1, registry: defaultRegistry })
    const byUser: Record<number, Message[]> = {}
    sim.on('message:arrived', (e) => {
      if (e.at === 'client-mem' && e.msg.kind === 'response' && sim.now > 10_000) (byUser[e.msg.meta.userIndex!] ??= []).push(e.msg)
    })
    sim.advance(10_000)
    const pinned = Object.entries((sim.nodeState('lb-mem') as { sticky: Record<string, string> }).sticky)
    const onFirst = pinned.filter(([, server]) => server === 'mem-1').length
    expect(onFirst).toBeGreaterThan(0)
    sim.setGraph({ ...sticky, nodes: sticky.nodes.map((n) => (n.id === 'mem-1' ? { ...n, config: { ...n.config, up: false } } : n)) })
    sim.advance(20_000)
    const all = Object.values(byUser).flat()
    const lost = all.filter((m) => m.code === 401 && m.meta.authError === 'session-lost')
    // At most one 401 per user that was pinned to the dead server (plus requests already on the wire).
    expect(lost.length).toBeGreaterThanOrEqual(onFirst)
    expect(lost.length).toBeLessThanOrEqual(2 * onFirst)
    // Only a request already on its way to the server when it went off may get a 503.
    expect(all.filter((m) => m.code === 503 && m.createdAt >= 10_000)).toEqual([])
    // Every user ends logged in again, and the last 10 s are clean.
    expect((sim.nodeState('client-mem') as { cookies: (string | null)[] }).cookies.every(Boolean)).toBe(true)
    expect(all.filter((m) => m.status === 'error' && m.createdAt > 20_000)).toEqual([])
  })
})

describe('reverse-proxy gateway auth', () => {
  it('the proxy requires credentials and an anonymous client starts idle', () => {
    const p = preset('reverse-proxy')
    expect(p.graph.nodes.find((n) => n.id === 'proxy')!.config.auth).toBe('credentials')
    expect(p.graph.nodes.find((n) => n.id === 'anon')!.config).toMatchObject({ auth: 'none', rate: 0, name: 'Sin credenciales' })
    expect(getPresets('en').find((x) => x.id === 'reverse-proxy')!.graph.nodes.find((n) => n.id === 'anon')!.config.name).toBe('Anonymous')
  })

  it('30 s: the anonymous client only gets 401 and never reaches a service; the others are served', () => {
    const sim = run('reverse-proxy')
    const byClient = responsesByClient(sim)
    const reached: string[] = []
    sim.on('message:arrived', (e) => {
      if (e.msg.kind === 'request' && ['usuarios', 'ordenes', 'pagos', 'web'].includes(e.at) && e.msg.meta.clientId === 'anon') reached.push(e.at)
    })
    sim.advance(30_000)
    const anon = byClient['anon'] ?? []
    expect(anon.length).toBeGreaterThan(5)
    expect(anon.every((m) => m.code === 401 && m.meta.authError === 'unauthenticated')).toBe(true)
    expect(reached).toEqual([])
    for (const id of ['web-client', 'mobile']) expect((byClient[id] ?? []).filter((m) => m.code === 401)).toEqual([])
  })

  it.each(['es', 'en'] as const)('every preset DSL compiles (%s)', (lang) => {
    for (const p of getPresets(lang)) expectDslsCompile(p, `${lang}/${p.id}`)
  })
})

describe('cache preset (cache-spec §7)', () => {
  const cacheOf = (lang: 'es' | 'en' = 'es') => getPresets(lang).find((p) => p.id === 'cache')!

  it('a client mixing 10 product paths at rate 0, a plain Servicio, a keys Cache of 5 and a relational database', () => {
    const p = cacheOf()
    expect(p.name).toBe('Cache')
    const byId = Object.fromEntries(p.graph.nodes.map((n) => [n.id, n]))
    expect(byId.client.config.rate).toBe(0)
    expect(p.demoRates.client).toBeGreaterThan(0)
    expect((byId.client.config.mix as { value: string }[]).map((r) => r.value)).toEqual(Array.from({ length: 10 }, (_, i) => `/productos/${i + 1}`))
    expect(byId.service.type).toBe('service')
    expect(byId.service.config.behavior).toBe('')
    expect(byId.cache.config).toMatchObject({ mode: 'keys', capacity: 5 })
    expect(byId.db.config.kind).toBe('relational')
    expect(p.graph.edges.map((e) => e.id)).toEqual(['client-service', 'service-cache', 'service-db'])
    // Entering the editor keeps the Cache in keys mode (the migration only touches Caches without a mode).
    expect(prepareGraph(p.graph).nodes.find((n) => n.id === 'cache')!.config.mode).toBe('keys')
    const en = cacheOf('en')
    expect(en.name).toBe('Cache')
    expect((en.graph.nodes.find((n) => n.id === 'client')!.config.mix as { value: string }[])[9].value).toBe('/products/10')
  })

  /** 30 s at seed 1 with the demo traffic; `capacity` overrides the Cache's. */
  function run30(capacity?: number) {
    const graph = withDemoTraffic(cacheOf())
    if (capacity !== undefined) graph.nodes = graph.nodes.map((n) => (n.id === 'cache' ? { ...n, config: { ...n.config, capacity } } : n))
    const sim = new Simulation(graph, { seed: 1, registry: defaultRegistry })
    let sent = 0
    let dbRequests = 0
    const clientCodes: number[] = []
    sim.on('message:sent', (e) => {
      if (e.from === 'client' && e.msg.kind === 'request') sent++
    })
    sim.on('message:arrived', (e) => {
      if (e.at === 'db' && e.msg.kind === 'request') dbRequests++
      if (e.at === 'client' && e.msg.kind === 'response') clientCodes.push(e.msg.code ?? 0)
    })
    sim.advance(10_000)
    const early = { ...sim.nodeState<CacheState>('cache') }
    sim.advance(20_000)
    const st = sim.nodeState<CacheState>('cache')
    const rate = (h: number, m: number) => h / Math.max(1, h + m)
    return {
      sent,
      dbRequests,
      clientCodes,
      keys: st.keys.length,
      earlyHit: rate(early.hits, early.misses),
      lateHit: rate(st.hits - early.hits, st.misses - early.misses),
      hit: rate(st.hits, st.misses),
    }
  }

  it('30 s: the database gets far fewer requests than the client sends, and the hit % rises over time', () => {
    const r = run30()
    expect(r.sent).toBeGreaterThan(40)
    expect(r.dbRequests).toBeLessThan(0.7 * r.sent)
    expect(r.lateHit).toBeGreaterThan(r.earlyHit)
    expect(r.keys).toBe(5)
    expect(r.clientCodes.every((c) => c === 200)).toBe(true)
  })

  it('30 s: with capacity 10 the hit % is higher and, once warm, the database almost idle', () => {
    const five = run30()
    const ten = run30(10)
    expect(ten.hit).toBeGreaterThan(five.hit)
    expect(ten.dbRequests).toBeLessThan(0.5 * five.dbRequests)
    // After the warm-up (10 cold keys, plus repeats requested before their first set landed) nearly every lookup hits.
    expect(ten.lateHit).toBeGreaterThan(0.95)
    expect(five.lateHit).toBeLessThan(0.7)
  })
})

describe('reverse-proxy edge cache (cache-spec §7)', () => {
  it('the proxy caches real keys on /static only', () => {
    const proxy = preset('reverse-proxy').graph.nodes.find((n) => n.id === 'proxy')!
    expect(proxy.config).toMatchObject({ cache: 'keys', cacheablePaths: ['/static'] })
  })

  it('30 s: only /static is answered from the proxy cache; Pagos is never answered by it', () => {
    const sim = run('reverse-proxy')
    const hitPaths: string[] = []
    const pagosSent: string[] = []
    const pagosArrived: string[] = []
    sim.on('message:arrived', (e) => {
      if (e.msg.kind === 'response' && e.msg.meta.cacheHit === true && e.at !== 'proxy') hitPaths.push(e.msg.meta.path ?? '')
      if (e.at === 'pagos' && e.msg.kind === 'request') pagosArrived.push(e.msg.id)
    })
    sim.on('message:sent', (e) => {
      // Requests still in flight at the end are left out.
      const path = e.msg.meta.path ?? ''
      if (e.to === 'proxy' && e.msg.kind === 'request' && e.msg.meta.clientId !== 'anon' && path.startsWith('/pagos') && e.msg.createdAt < 28_000) pagosSent.push(e.msg.id)
    })
    sim.advance(30_000)
    expect(hitPaths.length).toBeGreaterThan(5)
    expect(hitPaths.every((p) => p.startsWith('/static'))).toBe(true)
    // Every authenticated /pagos request reached Pagos.
    expect(pagosSent.length).toBeGreaterThan(5)
    expect(pagosSent.filter((id) => !pagosArrived.includes(id))).toEqual([])
    expect(sim.nodeState<CacheState>('proxy').keys.map((k) => k.key)).toEqual(['/static'])
  })
})
