import { describe, expect, it } from 'vitest'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Graph, Message } from '../../src/engine/types'
import { defineComponent, processingFields } from '../../src/engine/registry'
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

describe('ctx.occupy', () => {
  /** Occupies a slot and parks `release` in `held` until the test calls it. */
  let held: { msg: Message; release: () => void }[] = []
  const holder = defineComponent({
    type: 'holder',
    label: 'Holder',
    icon: 'h',
    color: 'slow',
    config: { ...processingFields },
    initialState: () => ({}),
    onMessage(msg, ctx) {
      ctx.occupy(msg, (release) => held.push({ msg, release }))
    },
  })

  function setupHolder(config: Record<string, unknown> = {}) {
    held = []
    const registry = makeRegistry()
    registry.register(holder)
    const g = graph([node('H', 'holder', { processingTime: PT, capacity: 1, queueMax: 10, up: true, ...config })])
    const sim = new Simulation(g, { registry })
    const drops: SimEvents['message:dropped'][] = []
    const stats: SimEvents['node:stats'][] = []
    sim.on('message:dropped', (p) => drops.push(p))
    sim.on('node:stats', (p) => stats.push(p))
    return { sim, drops, stats }
  }

  it('waits processingTime, then runs with the slot held until release', () => {
    const { sim } = setupHolder()
    sim.inject('H', req())
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 1, queued: 0 })
    sim.advance(PT - 1)
    expect(held).toHaveLength(0)
    sim.advance(1)
    expect(held).toHaveLength(1)
    sim.advance(10 * PT)
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 1 })
    held[0].release()
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 0 })
  })

  it('capacity 1: a second occupy queues until the first releases', () => {
    const { sim } = setupHolder()
    const a = req()
    const b = req()
    sim.inject('H', a)
    sim.inject('H', b)
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 1, queued: 1 })
    sim.advance(5 * PT)
    expect(held.map((h) => h.msg.id)).toEqual([a.id])
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 1, queued: 1 })

    held[0].release()
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 1, queued: 0 })
    sim.advance(PT)
    expect(held.map((h) => h.msg.id)).toEqual([a.id, b.id])
  })

  it('release twice frees only once', () => {
    const { sim } = setupHolder({ capacity: 2 })
    sim.inject('H', req())
    sim.inject('H', req())
    sim.inject('H', req())
    sim.advance(PT)
    expect(held).toHaveLength(2)
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 2, queued: 1 })
    held[0].release()
    held[0].release()
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 2, queued: 0 })
    held[1].release()
    held[1].release()
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 1, queued: 0 })
    sim.advance(PT)
    held[2].release()
    held[2].release()
    expect(sim.nodeStats('H')).toMatchObject({ inFlight: 0, queued: 0 })
  })

  it('emits inFlight and queued stats', () => {
    const { sim, stats } = setupHolder()
    sim.inject('H', req())
    expect(stats.at(-1)!.stats).toMatchObject({ inFlight: 1, queued: 0 })
    sim.inject('H', req())
    expect(stats.at(-1)!.stats).toMatchObject({ inFlight: 1, queued: 1 })
    sim.advance(PT)
    held[0].release()
    expect(stats.at(-1)!.stats).toMatchObject({ inFlight: 1, queued: 0 })
    sim.advance(PT)
    held[1].release()
    expect(stats.at(-1)!.stats).toMatchObject({ inFlight: 0, queued: 0 })
  })

  it('down node rejects with 503 down', () => {
    const { sim, drops } = setupHolder({ up: false })
    sim.inject('H', req())
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({ at: 'H', reason: 'down', code: 503 })
    sim.advance(2 * PT)
    expect(held).toHaveLength(0)
  })

  it('full queue rejects with 503 queue-full', () => {
    const { sim, drops } = setupHolder({ queueMax: 0 })
    sim.inject('H', req())
    sim.inject('H', req())
    expect(drops.map((d) => [d.reason, d.code])).toEqual([['queue-full', 503]])
  })

  it('release after the node was removed is harmless', () => {
    const { sim, stats } = setupHolder()
    sim.inject('H', req())
    sim.advance(PT)
    expect(held).toHaveLength(1)
    sim.setGraph(graph([]))
    const before = stats.length
    expect(() => held[0].release()).not.toThrow()
    expect(stats.length).toBe(before)
  })
})
