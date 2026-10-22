import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode } from '../../src/engine/types'
import { uiCopy, uiSignature, type LbView } from '../../src/ui/runtime/useSimulation'
import { lbAdvanced, lbSummary } from '../../src/ui/LbAdvancedSection'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })

/** 3 clients → LB → web-1/2/3 → base (the showcase scenario). */
function scenario(algorithm: string): Graph {
  return {
    nodes: [
      node('A', 'client', { rate: 0, burstSize: 12, name: 'Cliente A', color: '#38bdf8', ip: '10.0.0.11' }),
      node('B', 'client', { rate: 0, burstSize: 12, name: 'Cliente B', color: '#a78bfa', ip: '10.0.0.12' }),
      node('C', 'client', { rate: 0, burstSize: 12, name: 'Cliente C', color: '#f472b6', ip: '10.0.0.13' }),
      node('LB', 'load-balancer', { algorithm }),
      node('web-1', 'service', { name: 'web-1', processingTime: 50 }),
      node('web-2', 'service', { name: 'web-2', processingTime: 50 }),
      node('web-3', 'service', { name: 'web-3', processingTime: 50 }),
      node('db', 'database', { name: 'Base' }),
    ],
    edges: [
      edge('A', 'LB'),
      edge('B', 'LB'),
      edge('C', 'LB'),
      edge('LB', 'web-1'),
      edge('LB', 'web-2'),
      edge('LB', 'web-3'),
      edge('web-1', 'db'),
      edge('web-2', 'db'),
      edge('web-3', 'db'),
    ],
  }
}

function runScenario(algorithm: string): { graph: Graph; lb: LbView } {
  const graph = scenario(algorithm)
  const s = new Simulation(graph, { seed: 7, registry: defaultRegistry })
  for (const c of ['A', 'B', 'C']) s.runAction(c, 'burst')
  s.advance(20_000)
  const lb = uiCopy(s.nodeState('LB')).lb!
  return { graph, lb }
}

describe('LB → UiState (uiCopy / uiSignature)', () => {
  it('uiSignature recognizes the LB state and changes as routing accumulates', () => {
    const graph = scenario('round-robin')
    const s = new Simulation(graph, { seed: 7, registry: defaultRegistry })
    const before = uiSignature(s.nodeState('LB'))
    expect(before).toMatch(/^lb\|/)
    s.runAction('A', 'burst')
    s.advance(20_000)
    const after = uiSignature(s.nodeState('LB'))
    expect(after).not.toBe(before)
  })

  it('uiCopy exposes next, inflight, stickyCount and the per-client routed matrix', () => {
    const { lb } = runScenario('round-robin')
    const total = Object.values(lb.routed).reduce((n, r) => n + r.total, 0)
    expect(total).toBe(36) // 3 clients × 12 requests
    expect(typeof lb.next).toBe('number')
    expect(lb.stickyCount).toBe(0)
    // Each server keeps the color and name of the clients that reached it.
    const web1 = lb.routed['web-1']
    expect(web1.total).toBeGreaterThan(0)
    const colors = Object.values(web1.byClient).map((c) => c.color)
    expect(colors).toContain('#38bdf8')
  })

  it('a non-LB state is not mistaken for one', () => {
    expect(uiCopy({ items: [] })).toEqual({ items: { head: [], total: 0 } })
    expect(uiSignature({ cookies: [true, false] })).toBe('c:1')
  })
})

describe('lbAdvanced / lbSummary', () => {
  it('round-robin: parejo, marca el cursor en un servidor y sin chip', () => {
    const { graph, lb } = runScenario('round-robin')
    const adv = lbAdvanced(graph, 'LB', lb, 'round-robin')
    expect(adv.rows.map((r) => r.name)).toEqual(['web-1', 'web-2', 'web-3'])
    expect(adv.total).toBe(36)
    expect(adv.rows.every((r) => r.total === 12)).toBe(true)
    expect(adv.rows.filter((r) => r.isNext)).toHaveLength(1)
    expect(adv.rows.every((r) => r.chip === null)).toBe(true)
    expect(lbSummary(lb, adv, 'round-robin')).toMatch(/next →/)
  })

  it('least-connections: muestra un chip inflight por servidor', () => {
    const { graph, lb } = runScenario('least-connections')
    const adv = lbAdvanced(graph, 'LB', lb, 'least-connections')
    expect(adv.rows.every((r) => r.chip?.startsWith('inflight'))).toBe(true)
    expect(lbSummary(lb, adv, 'least-connections')).toMatch(/^inflight/)
  })

  it('ip-hash: cada servidor recibe de un solo cliente (una sola franja)', () => {
    const { graph, lb } = runScenario('ip-hash')
    const adv = lbAdvanced(graph, 'LB', lb, 'ip-hash')
    for (const r of adv.rows) if (r.total > 0) expect(r.slices).toHaveLength(1)
  })

  it('weighted: el chip es el peso de la conexión', () => {
    const graph = scenario('weighted')
    graph.edges = graph.edges.map((e) => (e.source === 'LB' ? { ...e, weight: e.target === 'web-1' ? 3 : e.target === 'web-2' ? 2 : 1 } : e))
    const s = new Simulation(graph, { seed: 7, registry: defaultRegistry })
    for (const c of ['A', 'B', 'C']) s.runAction(c, 'burst')
    s.advance(20_000)
    const lb = uiCopy(s.nodeState('LB')).lb!
    const adv = lbAdvanced(graph, 'LB', lb, 'weighted')
    expect(adv.rows.map((r) => r.chip)).toEqual(['×3', '×2', '×1'])
  })

  it('slices add up to each server total and carry the client name', () => {
    const { graph, lb } = runScenario('round-robin')
    const adv = lbAdvanced(graph, 'LB', lb, 'round-robin')
    for (const r of adv.rows) {
      expect(r.slices.reduce((n, c) => n + c.n, 0)).toBe(r.total)
      for (const c of r.slices) expect(c.name).toMatch(/^Cliente [ABC]$/)
    }
  })
})
