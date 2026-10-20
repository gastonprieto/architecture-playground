import { describe, expect, it } from 'vitest'
import { HOP_MS, MAX_TRAIL, Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Message } from '../../src/engine/types'
import { edge, graph, makeRegistry, node } from './fixtures'

type Rec = { [K in keyof SimEvents]: { type: K; p: SimEvents[K]; t: number } }[keyof SimEvents]

function record(sim: Simulation): Rec[] {
  const log: Rec[] = []
  const types: (keyof SimEvents)[] = [
    'message:sent',
    'message:arrived',
    'message:dropped',
    'node:stats',
    'node:label',
    'metrics:tick',
    'sim:reset',
  ]
  for (const type of types) sim.on(type, (p) => log.push({ type, p, t: sim.now } as Rec))
  return log
}

const of = <K extends keyof SimEvents>(log: Rec[], type: K) =>
  log.filter((e) => e.type === type) as { type: K; p: SimEvents[K]; t: number }[]

const req = (meta: Message['meta'] = { path: '/' }): Message => ({
  id: 'r1',
  kind: 'request',
  meta,
  trail: [],
  createdAt: 0,
})

// origin A (fwd) -> B (fwd) -> C (echo)
const chain = () =>
  graph([node('A', 'fwd'), node('B', 'fwd'), node('C', 'echo')], [edge('A', 'B'), edge('B', 'C')])

describe('Simulation', () => {
  it('exposes HOP_MS and MAX_TRAIL', () => {
    expect(HOP_MS).toBe(600)
    expect(MAX_TRAIL).toBe(32)
  })

  it('request round trip', () => {
    const sim = new Simulation(chain(), { registry: makeRegistry() })
    const log = record(sim)
    sim.inject('A', req())
    sim.advance(10 * HOP_MS)

    const sent = of(log, 'message:sent')
    expect(sent.map((e) => [e.p.from, e.p.to, e.p.msg.kind])).toEqual([
      ['A', 'B', 'request'],
      ['B', 'C', 'request'],
      ['C', 'B', 'response'],
      ['B', 'A', 'response'],
    ])
    expect(sent.map((e) => e.p.edgeId)).toEqual(['A-B', 'B-C', 'B-C', 'A-B'])
    expect(sent.every((e) => e.p.duration === HOP_MS)).toBe(true)
    expect(sent.map((e) => e.p.at)).toEqual([0, HOP_MS, 2 * HOP_MS, 3 * HOP_MS])

    const arrivedAtA = of(log, 'message:arrived').filter((e) => e.p.at === 'A' && e.p.msg.kind === 'response')
    expect(arrivedAtA).toHaveLength(1)
    expect(arrivedAtA[0].t).toBe(4 * HOP_MS)
    const res = arrivedAtA[0].p.msg
    expect(res).toMatchObject({ kind: 'response', replyTo: 'r1', status: 'ok', code: 200, trail: [], createdAt: 0 })

    // the request accumulated the trail along the way
    expect(sent[1].p.msg.trail).toEqual(['A', 'B'])
    expect(sent[2].p.msg.trail).toEqual(['A'])
    expect(sim.nodeStats('C')).toEqual({ inFlight: 0, queued: 0, ok: 1, errors: 0 })
  })

  it('send without edge uses edgeId null', () => {
    const sim = new Simulation(graph([node('P', 'echo'), node('Q', 'echo')]), { registry: makeRegistry() })
    const log = record(sim)
    sim.inject('P', { ...req(), trail: ['Q'] })
    const sent = of(log, 'message:sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].p).toMatchObject({ from: 'P', to: 'Q', edgeId: null, duration: HOP_MS })
  })

  it('reply to a message with an empty trail does nothing', () => {
    const sim = new Simulation(chain(), { registry: makeRegistry() })
    const log = record(sim)
    sim.inject('C', req())
    sim.advance(5 * HOP_MS)
    expect(of(log, 'message:sent')).toHaveLength(0)
  })

  it('drops looping messages', () => {
    const sim = new Simulation(graph([node('A', 'fwd'), node('B', 'fwd')], [edge('A', 'B'), edge('B', 'A')]), {
      registry: makeRegistry(),
    })
    const log = record(sim)
    sim.inject('A', req())
    expect(() => sim.advance(40 * HOP_MS)).not.toThrow()
    const loops = of(log, 'message:dropped').filter((e) => e.p.reason === 'loop')
    expect(loops).toHaveLength(1)
    expect(loops[0].p.msg.trail).toHaveLength(MAX_TRAIL)
    // the dropped request is answered with a 503 that walks back to the origin
    sim.advance(40 * HOP_MS)
    const finalArrival = of(log, 'message:arrived')
      .filter((e) => e.p.msg.kind === 'response')
      .at(-1)!
    expect(finalArrival.p).toMatchObject({ at: 'A', msg: { status: 'error', code: 503, trail: [] } })
  })

  it('unknown type drops', () => {
    const sim = new Simulation(graph([node('A', 'fwd'), node('N', 'nope')], [edge('A', 'N')]), {
      registry: makeRegistry(),
    })
    const log = record(sim)
    sim.inject('A', req())
    sim.advance(3 * HOP_MS)
    const dropped = of(log, 'message:dropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].p).toMatchObject({ at: 'N', reason: 'tipo desconocido' })
    expect(sim.nodeStats('N').errors).toBe(1)
  })

  it('drop on a request replies an error with the given code (default 503)', () => {
    const sim = new Simulation(graph([node('A', 'gen'), node('R', 'reject')]), {
      registry: makeRegistry(),
    })
    sim.inject('R', { ...req(), trail: ['A'] })
    sim.advance(HOP_MS)
    expect(sim.nodeState<{ responses: { code?: number }[] }>('A').responses).toEqual([
      { at: HOP_MS, createdAt: 0, code: 429 },
    ])
    expect(sim.nodeStats('R')).toEqual({ inFlight: 0, queued: 0, ok: 0, errors: 1 })
  })

  it('process waits processingTime before done', () => {
    const sim = new Simulation(
      graph([node('A', 'gen'), node('S', 'slow', { processingTime: 250 })]),
      { registry: makeRegistry() },
    )
    const log = record(sim)
    sim.inject('S', { ...req(), trail: ['A'] })
    sim.advance(249)
    expect(of(log, 'message:sent')).toHaveLength(0)
    sim.advance(1)
    expect(of(log, 'message:sent')).toHaveLength(1)
  })

  it('emits node:stats when stats change', () => {
    const sim = new Simulation(chain(), { registry: makeRegistry() })
    const log = record(sim)
    sim.inject('A', req())
    sim.advance(10 * HOP_MS)
    expect(of(log, 'node:stats').map((e) => e.p)).toEqual([
      { nodeId: 'C', stats: { inFlight: 0, queued: 0, ok: 1, errors: 0 } },
    ])
  })

  it('calls onTick every 100 sim-ms with dtMs 100', () => {
    const sim = new Simulation(graph([node('G', 'gen')]), { registry: makeRegistry() })
    sim.advance(350)
    expect(sim.nodeState<{ ticks: number[] }>('G').ticks).toEqual([100, 100, 100])
    sim.advance(50)
    expect(sim.nodeState<{ ticks: number[] }>('G').ticks).toHaveLength(4)
  })

  it('setGraph keeps state and drops orphans', () => {
    const reg = makeRegistry()
    const sim = new Simulation(graph([node('A', 'fwd'), node('B', 'echo')], [edge('A', 'B')]), { registry: reg })
    const log = record(sim)
    const stateA = sim.nodeState('A')
    sim.inject('A', req())
    sim.advance(HOP_MS / 2)
    sim.setGraph(graph([node('A', 'fwd', { name: 'renamed' })]))
    sim.advance(HOP_MS)
    const dropped = of(log, 'message:dropped')
    expect(dropped.map((e) => [e.p.at, e.p.reason])).toEqual([['B', 'removed']])
    expect(sim.nodeState('A')).toBe(stateA)
  })

  it('setGraph drops messages whose edge was removed, and gives new nodes initial state', () => {
    const sim = new Simulation(graph([node('A', 'fwd'), node('B', 'echo')], [edge('A', 'B')]), {
      registry: makeRegistry(),
    })
    const log = record(sim)
    sim.inject('A', req())
    sim.advance(HOP_MS / 2)
    sim.setGraph(graph([node('A', 'fwd'), node('B', 'echo'), node('K', 'counter')]))
    sim.advance(HOP_MS)
    expect(of(log, 'message:dropped').map((e) => [e.p.at, e.p.reason])).toEqual([['B', 'removed']])
    expect(sim.nodeState('K')).toEqual({ count: 0 })
  })

  it('runAction calls def.actions[name].run', () => {
    const sim = new Simulation(graph([node('K', 'counter')]), { registry: makeRegistry() })
    const log = record(sim)
    sim.runAction('K', 'bump')
    sim.runAction('K', 'bump')
    sim.runAction('K', 'missing')
    expect(sim.nodeState('K')).toEqual({ count: 2 })
    expect(of(log, 'node:label').map((e) => e.p)).toEqual([
      { nodeId: 'K', text: '+1', tone: 'ok' },
      { nodeId: 'K', text: '+2', tone: 'ok' },
    ])
  })

  it('metrics returns zeros', () => {
    const sim = new Simulation(graph([]), { registry: makeRegistry() })
    expect(sim.metrics()).toEqual({ throughput: 0, p50: 0, p95: 0, errorRate: 0 })
  })

  it('deterministic', () => {
    const run = (seed: number) => {
      const g = graph(
        [node('G', 'gen'), node('F', 'fwd'), node('E', 'echo')],
        [edge('G', 'F'), edge('F', 'E')],
      )
      const sim = new Simulation(g, { registry: makeRegistry(), seed })
      const log = record(sim)
      sim.advance(10_000)
      return { log: JSON.stringify(log), responses: sim.nodeState<{ responses: unknown[] }>('G').responses }
    }
    const a = run(42)
    const b = run(42)
    expect(a.log).toBe(b.log)
    expect(a.responses.length).toBeGreaterThan(0)
    expect(run(43).log).not.toBe(a.log)
  })

  it('response latency can be computed at the originator from createdAt', () => {
    const sim = new Simulation(
      graph([node('G', 'gen'), node('E', 'echo')], [edge('G', 'E')]),
      { registry: makeRegistry(), seed: 1 },
    )
    sim.advance(5_000)
    const { responses } = sim.nodeState<{ responses: { at: number; createdAt: number }[] }>('G')
    expect(responses.length).toBeGreaterThan(0)
    for (const r of responses) expect(r.at - r.createdAt).toBe(2 * HOP_MS)
  })
})
