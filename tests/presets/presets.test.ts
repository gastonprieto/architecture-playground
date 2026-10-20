import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation } from '../../src/engine/simulation'
import type { Message } from '../../src/engine/types'
import { parseGraph, serializeGraph } from '../../src/persistence/serialize'
import { presets } from '../../src/presets'

const preset = (id: string) => presets.find((p) => p.id === id)!
const run = (id: string) => {
  const sim = new Simulation(preset(id).graph, { seed: 1, registry: defaultRegistry })
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
  it('exposes the four presets with valid, uniquely-id graphs', () => {
    expect(presets.map((p) => p.id)).toEqual(['load-balancer', 'sync-vs-queue', 'pubsub', 'reverse-proxy'])
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

  it('every preset survives parseGraph(serializeGraph(g))', () => {
    for (const p of presets) expect(parseGraph(serializeGraph(p.graph))).toEqual({ ok: true, graph: p.graph })
  })
})
