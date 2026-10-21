import { describe, expect, it } from 'vitest'
import { compileBehavior } from '../../src/components/behavior'
import { defaultRegistry } from '../../src/components/index'
import { Simulation } from '../../src/engine/simulation'
import type { Message } from '../../src/engine/types'
import { parseGraph, serializeGraph } from '../../src/persistence/serialize'
import { getPresets, withDemoTraffic } from '../../src/presets'
import { CLIENT_COLORS } from '../../src/ui/colors'
import type { Graph } from '../../src/engine/types'

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
  it('exposes the five presets with valid, uniquely-id graphs', () => {
    expect(presets.map((p) => p.id)).toEqual(['load-balancer', 'sync-vs-queue', 'pubsub', 'reverse-proxy', 'purchase-order'])
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
    expect(enPresets.map((p) => p.name)).toEqual(['Load Balancer', 'Sync vs queue', 'Pub/sub', 'Reverse Proxy', 'Purchase order'])
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
