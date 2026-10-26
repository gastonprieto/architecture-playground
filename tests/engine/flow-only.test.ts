import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation } from '../../src/engine/simulation'
import type { Graph, GraphNode, NodeStats } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })

/** A Cliente C (no rate, 10 requests per "Enviar") chained through `rest`. */
function chain(...rest: GraphNode[]): Graph {
  const nodes = [node('C', 'client', { rate: 0, sendCount: 10 }), ...rest]
  const edges = nodes.slice(1).map((n, i) => ({ id: `${nodes[i].id}-${n.id}`, source: nodes[i].id, target: n.id }))
  return { nodes, edges }
}

/** C sends its 10 requests at once; returns the counters of `at` (C by default) once everything settled. */
function run(g: Graph, flowOnly: boolean, at = 'C'): NodeStats {
  const s = new Simulation(g, { seed: 1, registry: defaultRegistry })
  s.setFlowOnly(flowOnly)
  s.runAction('C', 'send1')
  s.advance(20_000)
  return s.nodeStats(at)
}

/** One slot and no waiting room: 9 of 10 simultaneous requests are rejected. */
const saturated = (config: Record<string, unknown> = {}) => node('S', 'service', { capacity: 1, queueMax: 0, processingTime: 200, ...config })

describe('flow-only mode', () => {
  it('ignores the capacity and waiting room of a service', () => {
    expect(run(chain(saturated()), false).errors).toBe(9)
    expect(run(chain(saturated()), true)).toMatchObject({ ok: 10, errors: 0 })
  })

  it('a node that is off still fails', () => {
    expect(run(chain(saturated({ up: false })), true)).toMatchObject({ ok: 0, errors: 10 })
  })

  it('ignores the rate limit of a reverse proxy', () => {
    const g = () => chain(node('P', 'reverse-proxy', { rateLimit: 1 }), node('S', 'service'))
    expect(run(g(), false).errors).toBe(9)
    expect(run(g(), true)).toMatchObject({ ok: 10, errors: 0 })
  })

  it('ignores the fail rate of a worker', () => {
    const g = () => chain(node('Q', 'queue', { maxRetries: 0 }), node('W', 'worker', { failRate: 1, capacity: 10 }))
    expect(run(g(), false, 'W').errors).toBe(10)
    expect(run(g(), true, 'W')).toMatchObject({ ok: 10, errors: 0 })
  })

  it('ignores the max length of a queue; workers still pull at their configured pace', () => {
    const g = () => chain(node('Q', 'queue', { queueMax: 1 }), node('W', 'worker', { capacity: 1 }))
    expect(run(g(), false).errors).toBeGreaterThan(0)
    expect(run(g(), true)).toMatchObject({ ok: 10, errors: 0 })
    expect(run(g(), true, 'W').ok).toBe(10)
  })

  it("ignores the DSL's `fail N%`", () => {
    const g = () => chain(node('S', 'service', { capacity: 10, behavior: 'on request:\n  fail 100%\n' }))
    expect(run(g(), false).errors).toBe(10)
    expect(run(g(), true)).toMatchObject({ ok: 10, errors: 0 })
  })

  it('turning it on or off starts the counters over', () => {
    const s = new Simulation(chain(saturated()), { seed: 1, registry: defaultRegistry })
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(s.nodeStats('C').errors).toBe(9)
    s.setFlowOnly(true)
    expect(s.nodeStats('C')).toMatchObject({ ok: 0, errors: 0 })
    s.runAction('C', 'send1')
    s.advance(5000)
    s.setFlowOnly(false)
    expect(s.nodeStats('C')).toMatchObject({ ok: 0, errors: 0 })
  })

  it('what was already travelling when the mode changed is not counted, in the counters nor the metrics', () => {
    const g = chain(node('S', 'service', { capacity: 1, queueMax: 0, processingTime: 500 }))
    g.nodes[0].config.rate = 5
    const s = new Simulation(g, { seed: 1, registry: defaultRegistry })
    s.advance(5000)
    expect(s.metrics().errorRate).toBeGreaterThan(0)
    s.setFlowOnly(true)
    s.advance(3000)
    expect(s.nodeStats('C').errors).toBe(0)
    expect(s.nodeStats('C').ok).toBeGreaterThan(0)
    expect(s.metrics().errorRate).toBe(0)
  })

  it('changing the mode publishes the reset metrics right away (the bar updates while paused)', () => {
    const s = new Simulation(chain(saturated()), { seed: 1, registry: defaultRegistry })
    s.runAction('C', 'send1')
    s.advance(5000)
    const ticks: number[] = []
    s.on('metrics:tick', (m) => ticks.push(m.errorRate))
    s.setFlowOnly(true)
    expect(ticks).toEqual([0])
  })

  it('turning it off brings the limits back', () => {
    const s = new Simulation(chain(saturated()), { seed: 1, registry: defaultRegistry })
    s.setFlowOnly(true)
    s.setFlowOnly(false)
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(s.nodeStats('C').errors).toBe(9)
  })

  it('turning it on starts what was waiting in a full node', () => {
    const s = new Simulation(chain(saturated({ queueMax: 10, processingTime: 10_000 })), { seed: 1, registry: defaultRegistry })
    s.runAction('C', 'send1')
    s.advance(1000)
    expect(s.nodeStats('S')).toMatchObject({ inFlight: 1, queued: 9 })
    s.setFlowOnly(true)
    expect(s.nodeStats('S')).toMatchObject({ inFlight: 10, queued: 0 })
  })
})
