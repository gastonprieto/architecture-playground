import { describe, expect, it } from 'vitest'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Graph, Message } from '../../src/engine/types'
import { graph, makeRegistry, node } from './fixtures'

const PT = 400

let seq = 0
const req = (): Message => ({ id: `r${++seq}`, kind: 'request', meta: { path: '/' }, trail: [], createdAt: 0 })

const procGraph = (config: Record<string, unknown> = {}): Graph =>
  graph([node('P', 'proc', { processingTime: PT, capacity: 2, queueMax: 10, up: true, ...config })])

function setup(config: Record<string, unknown> = {}) {
  const sim = new Simulation(procGraph(config), { registry: makeRegistry() })
  const drops: SimEvents['message:dropped'][] = []
  const stats: SimEvents['node:stats'][] = []
  sim.on('message:dropped', (p) => drops.push(p))
  sim.on('node:stats', (p) => stats.push(p))
  return { sim, drops, stats }
}

describe('ctx.process', () => {
  it('processes up to capacity concurrently, queues the rest', () => {
    const { sim, stats } = setup()
    sim.inject('P', req())
    sim.inject('P', req())
    sim.inject('P', req())
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 2, queued: 1, ok: 0 })
    expect(stats.at(-1)!.stats).toMatchObject({ inFlight: 2, queued: 1 })

    sim.advance(PT)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 0, ok: 2 })

    sim.advance(PT - 1)
    expect(sim.nodeStats('P').ok).toBe(2)
    sim.advance(1) // third completes at 2 * processingTime
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 0, queued: 0, ok: 3 })
  })

  it('rejects with 503 when queue is full', () => {
    const { sim, drops } = setup({ capacity: 1, queueMax: 1 })
    sim.inject('P', req())
    sim.inject('P', req())
    sim.inject('P', req())
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 1, errors: 1 })
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({ at: 'P', reason: 'queue-full', code: 503 })
    sim.advance(2 * PT)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 0, queued: 0, ok: 2, errors: 1 })
  })

  it('queueMax 0 rejects as soon as all slots are busy', () => {
    const { sim, drops } = setup({ capacity: 1, queueMax: 0 })
    sim.inject('P', req())
    sim.inject('P', req())
    expect(drops.map((d) => d.reason)).toEqual(['queue-full'])
  })

  it('down node rejects new arrivals with 503', () => {
    const { sim, drops } = setup({ up: false })
    sim.inject('P', req())
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({ at: 'P', reason: 'down', code: 503 })
    sim.advance(2 * PT)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 0, queued: 0, ok: 0, errors: 1 })
  })

  it('turning a node down rejects its queued items but lets in-flight finish', () => {
    const { sim, drops } = setup({ capacity: 1 })
    sim.inject('P', req())
    sim.inject('P', req())
    sim.inject('P', req())
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 2 })

    sim.advance(PT / 2)
    sim.setGraph(procGraph({ capacity: 1, up: false }))
    expect(drops.map((d) => [d.reason, d.code])).toEqual([
      ['down', 503],
      ['down', 503],
    ])
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 0, errors: 2 })

    sim.advance(PT / 2)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 0, queued: 0, ok: 1, errors: 2 })
  })

  it('lowering capacity below inFlight lets current work finish and starts no new work until below', () => {
    const { sim } = setup({ capacity: 3 })
    for (let i = 0; i < 5; i++) sim.inject('P', req())
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 3, queued: 2 })

    sim.setGraph(procGraph({ capacity: 1 }))
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 3, queued: 2 })

    sim.advance(PT) // the 3 in-flight finish; only one queued starts (capacity 1)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 1, ok: 3 })
    sim.advance(PT)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 0, ok: 4 })
    sim.advance(PT)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 0, queued: 0, ok: 5 })
  })

  it('raising capacity starts queued work immediately', () => {
    const { sim } = setup({ capacity: 1 })
    for (let i = 0; i < 3; i++) sim.inject('P', req())
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 1, queued: 2 })
    sim.setGraph(procGraph({ capacity: 3 }))
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 3, queued: 0 })
    sim.advance(PT)
    expect(sim.nodeStats('P')).toMatchObject({ inFlight: 0, ok: 3 })
  })

  it('components without processing fields default to unlimited capacity, always up', () => {
    const sim = new Simulation(graph([node('S', 'slow', { processingTime: 100 })]), { registry: makeRegistry() })
    for (let i = 0; i < 20; i++) sim.inject('S', req())
    expect(sim.nodeStats('S')).toMatchObject({ inFlight: 20, queued: 0 })
    sim.advance(100)
    expect(sim.nodeStats('S')).toMatchObject({ inFlight: 0, ok: 20 })
  })
})
