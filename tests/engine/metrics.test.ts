import { describe, expect, it } from 'vitest'
import { METRICS_MIN_SPAN_MS, METRICS_WINDOW_MS, RollingMetrics } from '../../src/engine/metrics'
import { HOP_MS, METRICS_TICK_MS, Simulation } from '../../src/engine/simulation'
import type { MetricsSnapshot } from '../../src/engine/types'
import { edge, graph, makeRegistry, node } from './fixtures'

describe('RollingMetrics', () => {
  it('uses a 5000 ms window', () => {
    expect(METRICS_WINDOW_MS).toBe(5000)
  })

  it('computes throughput and nearest-rank p50/p95', () => {
    const m = new RollingMetrics()
    for (let lat = 100; lat <= 1000; lat += 100) m.record(0, lat, true)
    // 10 completions over the full 5 s window.
    expect(m.snapshot(METRICS_WINDOW_MS)).toEqual({ throughput: 2, p50: 500, p95: 1000, errorRate: 0 })
  })

  it('divides by the time since the first completion until a window has passed, so the real rate shows at once', () => {
    expect(METRICS_MIN_SPAN_MS).toBe(1000)
    // Responses start coming back late (a round trip), then at 2/s.
    const m = new RollingMetrics()
    for (let at = 6000; at <= 8000; at += 500) m.record(at, 100, true)
    // 5 completions over the 2 s since the first plus the 1 s lead-in (the full 5 s window would read 1).
    expect(m.snapshot(8000).throughput).toBeCloseTo(5 / 3)
    // The lead-in keeps the very first completion from reading as a spike.
    const early = new RollingMetrics()
    early.record(200, 100, true)
    expect(early.snapshot(200).throughput).toBe(1)
    // A whole window after the first completion it is the plain 5 s window again.
    expect(m.snapshot(11000).throughput).toBeCloseTo(1)
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
    // The first completion, just now: one over the 1 s lead-in.
    expect(sim.metrics()).toEqual({ throughput: 1, p50: 2 * HOP_MS, p95: 2 * HOP_MS, errorRate: 0 })
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
    expect(sim.metrics()).toEqual({ throughput: 1, p50: 4 * HOP_MS, p95: 4 * HOP_MS, errorRate: 0 })
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
    // The completion came 300 ms ago: 1 over 0.3 s plus the 1 s lead-in.
    expect(ticks[2].p).toMatchObject({ p50: 2 * HOP_MS, p95: 2 * HOP_MS, errorRate: 0 })
    expect(ticks[2].p.throughput).toBeCloseTo(1 / 1.3)
  })
})
