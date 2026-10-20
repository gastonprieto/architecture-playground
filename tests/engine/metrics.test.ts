import { describe, expect, it } from 'vitest'
import { METRICS_WINDOW_MS, RollingMetrics } from '../../src/engine/metrics'
import { HOP_MS, METRICS_TICK_MS, Simulation } from '../../src/engine/simulation'
import type { MetricsSnapshot } from '../../src/engine/types'
import { edge, graph, makeRegistry, node } from './fixtures'

describe('RollingMetrics', () => {
  it('uses a 5000 ms window', () => {
    expect(METRICS_WINDOW_MS).toBe(5000)
  })

  it('computes throughput and nearest-rank p50/p95', () => {
    const m = new RollingMetrics()
    for (let lat = 100; lat <= 1000; lat += 100) m.record(1000, lat, true)
    expect(m.snapshot(1000)).toEqual({ throughput: 2, p50: 500, p95: 1000, errorRate: 0 })
  })

  it('evicts entries older than 5000 ms', () => {
    const m = new RollingMetrics()
    m.record(0, 999, true)
    m.record(3000, 100, true)
    expect(m.snapshot(5000)).toMatchObject({ throughput: 0.4, p95: 999 })
    expect(m.snapshot(5001)).toEqual({ throughput: 0.2, p50: 100, p95: 100, errorRate: 0 })
    expect(m.snapshot(8001)).toEqual({ throughput: 0, p50: 0, p95: 0, errorRate: 0 })
  })

  it('errorRate = errors / total', () => {
    const m = new RollingMetrics()
    m.record(0, 10, true)
    m.record(0, 10, false)
    m.record(0, 10, true)
    m.record(0, 10, false)
    m.record(0, 10, false)
    expect(m.snapshot(0).errorRate).toBeCloseTo(0.6)
  })

  it('is all zeros with no data', () => {
    expect(new RollingMetrics().snapshot(12345)).toEqual({ throughput: 0, p50: 0, p95: 0, errorRate: 0 })
  })
})

describe('Simulation metrics', () => {
  it('records a completion when a response reaches a recordsMetrics originator', () => {
    const sim = new Simulation(graph([node('O', 'origin'), node('E', 'echo')], [edge('O', 'E')]), {
      registry: makeRegistry(),
    })
    sim.runAction('O', 'send')
    sim.advance(2 * HOP_MS)
    expect(sim.metrics()).toEqual({ throughput: 0.2, p50: 2 * HOP_MS, p95: 2 * HOP_MS, errorRate: 0 })
  })

  it('counts error responses in errorRate', () => {
    const sim = new Simulation(graph([node('O', 'origin'), node('R', 'reject')], [edge('O', 'R')]), {
      registry: makeRegistry(),
    })
    sim.runAction('O', 'send')
    sim.advance(2 * HOP_MS)
    expect(sim.metrics().errorRate).toBe(1)
  })

  it('does not record at originators without recordsMetrics', () => {
    const sim = new Simulation(graph([node('G', 'gen'), node('E', 'echo')], [edge('G', 'E')]), {
      registry: makeRegistry(),
    })
    sim.advance(3000)
    expect(sim.nodeState<{ responses: unknown[] }>('G').responses.length).toBeGreaterThan(0)
    expect(sim.metrics()).toEqual({ throughput: 0, p50: 0, p95: 0, errorRate: 0 })
  })

  it('does not record at intermediate hops', () => {
    // O -> F -> E: only O (trail empty on arrival) records, once.
    const sim = new Simulation(
      graph([node('O', 'origin'), node('F', 'fwd'), node('E', 'echo')], [edge('O', 'F'), edge('F', 'E')]),
      { registry: makeRegistry() },
    )
    sim.runAction('O', 'send')
    sim.advance(4 * HOP_MS)
    expect(sim.metrics()).toEqual({ throughput: 0.2, p50: 4 * HOP_MS, p95: 4 * HOP_MS, errorRate: 0 })
  })

  it('emits metrics:tick every 500 sim-ms with the snapshot', () => {
    expect(METRICS_TICK_MS).toBe(500)
    const sim = new Simulation(graph([node('O', 'origin'), node('E', 'echo')], [edge('O', 'E')]), {
      registry: makeRegistry(),
    })
    const ticks: { t: number; p: MetricsSnapshot }[] = []
    sim.on('metrics:tick', (p) => ticks.push({ t: sim.now, p }))
    sim.runAction('O', 'send')
    sim.advance(1500)
    expect(ticks.map((x) => x.t)).toEqual([500, 1000, 1500])
    expect(ticks[0].p.throughput).toBe(0)
    expect(ticks[2].p).toEqual({ throughput: 0.2, p50: 2 * HOP_MS, p95: 2 * HOP_MS, errorRate: 0 })
  })
})
