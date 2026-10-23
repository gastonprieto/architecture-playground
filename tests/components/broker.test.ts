import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { HOP_MS, Simulation, type SimEvents } from '../../src/engine/simulation'
import type { EdgeRule, Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string, rule?: EdgeRule): GraphEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(rule ? { rule } : {}),
})
const ev = (value: string): EdgeRule => ({ kind: 'eventType', value })
const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

interface BrokerState {
  lanes: Record<string, Message[]>
  inFlight: Record<string, number>
  pending: Record<string, string>
}

/** Business messages sent by `from` (not responses, not pull probes). */
function sentFrom(s: Simulation, from: string): { msg: Message; to: string; at: number }[] {
  const out: { msg: Message; to: string; at: number }[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from && p.msg.kind !== 'response' && p.msg.kind !== 'poll') out.push({ msg: p.msg, to: p.to, at: p.at })
  })
  return out
}

function arrivedAt(s: Simulation, at: string, kind: Message['kind']): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === kind) out.push(p.msg)
  })
  return out
}

function labelsOf(s: Simulation, nodeId: string): string[] {
  const out: string[] = []
  s.on('node:label', (p) => p.nodeId === nodeId && out.push(`${p.text}:${p.tone}`))
  return out
}

/** C (events of type A by default) → B → S1..Sn, each edge with an optional rule. */
function brokerGraph(opts: {
  subs: { config?: Record<string, unknown>; rule?: EdgeRule }[]
  client?: Record<string, unknown>
}): Graph {
  const subs = opts.subs.map((sub, i) => node(`S${i + 1}`, 'subscriber', sub.config))
  return {
    nodes: [
      node('C', 'client', { rate: 0, kind: 'event', mix: [{ value: 'A', weight: 1 }], ...opts.client }),
      node('B', 'broker'),
      ...subs,
    ],
    edges: [edge('C', 'B'), ...opts.subs.map((sub, i) => edge('B', `S${i + 1}`, sub.rule))],
  }
}

describe('catalog', () => {
  it('registers broker and subscriber with their metadata and config', () => {
    const b = defaultRegistry.get('broker')!
    const sub = defaultRegistry.get('subscriber')!
    expect([b.label, b.icon, b.color]).toEqual(['Broker', '📡', 'hc'])
    expect([sub.label, sub.icon, sub.color]).toEqual(['Suscriptor', '📥', 'ok'])
    expect(sub.config.emits).toEqual({ type: 'text', label: 'Emite evento', default: '' })
    expect(Object.keys(sub.config)).toEqual(expect.arrayContaining(['up', 'processingTime', 'capacity', 'queueMax']))
  })
})

describe('broker', () => {
  it('an event without rules fans out to all 4 subscribers', () => {
    const s = sim(brokerGraph({ subs: [{}, {}, {}, {}] }))
    const fromB = sentFrom(s, 'B')
    const atC = arrivedAt(s, 'C', 'response')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(fromB.map((e) => e.to)).toEqual(['S1', 'S2', 'S3', 'S4'])
    expect(fromB.every((e) => e.msg.kind === 'event' && e.msg.meta.eventType === 'A')).toBe(true)
    // One fresh copy per lane: distinct ids, all derived from the published event.
    expect(new Set(fromB.map((e) => e.msg.id)).size).toBe(4)
    expect(['S1', 'S2', 'S3', 'S4'].map((id) => s.nodeStats(id).ok)).toEqual([1, 1, 1, 1])
    // Events get no reply; the acks stop at the broker.
    expect(atC).toEqual([])
    const st = s.nodeState<BrokerState>('B')
    expect(st.pending).toEqual({})
    expect(Object.values(st.inFlight).every((n) => n === 0)).toBe(true)
  })

  it('an eventType rule filters subscribers', () => {
    const s = sim(brokerGraph({ subs: [{ rule: ev('A') }, { rule: ev('B') }, {}] }))
    const fromB = sentFrom(s, 'B')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(fromB.map((e) => e.to)).toEqual(['S1', 'S3'])
    expect(s.nodeStats('S2').ok).toBe(0)
  })

  it("with no matching subscriber it labels 'no-subscribers' and drops", () => {
    const s = sim(brokerGraph({ subs: [{ rule: ev('B') }] }))
    const labels = labelsOf(s, 'B')
    const drops: SimEvents['message:dropped'][] = []
    s.on('message:dropped', (p) => drops.push(p))
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(labels).toContain('no-subscribers:slow')
    expect(drops.map((d) => [d.at, d.reason, d.msg.kind])).toEqual([['B', 'no-subscribers', 'event']])
  })

  it('a request gets 202 and is published as an event typed by its path', () => {
    const s = sim(brokerGraph({ subs: [{ rule: ev('/orders') }], client: { kind: 'request', mix: [{ value: '/orders', weight: 1 }] } }))
    const atC = arrivedAt(s, 'C', 'response')
    const fromC = sentFrom(s, 'C')
    const fromB = sentFrom(s, 'B')
    const labels = labelsOf(s, 'B')
    s.runAction('C', 'send1')
    s.advance(2 * HOP_MS)
    expect(atC.map((r) => [r.status, r.code])).toEqual([['ok', 202]])
    expect(labels).toContain('202:ok')
    s.advance(5000)
    expect(atC).toHaveLength(1)
    expect(fromB).toHaveLength(1)
    expect(fromB[0].msg).toMatchObject({ kind: 'event', meta: { path: '/orders', eventType: '/orders' } })
    expect(s.nodeStats('S1').ok).toBe(1)
    // The lane copy descends from the request through the derived event.
    expect(fromB[0].msg.parentId).toBeDefined()
    expect(fromB[0].msg.parentId).not.toBe(fromC[0].msg.id)
  })

  it('a request with an explicit eventType keeps it', () => {
    const s = sim(brokerGraph({ subs: [{ rule: ev('Pago') }], client: { kind: 'request' } }))
    const fromB = sentFrom(s, 'B')
    s.inject('B', { id: 'r1', kind: 'request', meta: { path: '/x', eventType: 'Pago' }, trail: ['C'], createdAt: 0 })
    s.advance(5000)
    expect(fromB.map((e) => [e.to, e.msg.meta.eventType])).toEqual([['S1', 'Pago']])
  })

  it('a slow subscriber accumulates its lane while fast ones stay empty', () => {
    const s = sim(
      brokerGraph({
        subs: [{ config: { processingTime: 3000, capacity: 1 } }, { config: { processingTime: 50, capacity: 5 } }],
        client: { burstSize: 10 },
      }),
    )
    let maxSlow = 0
    s.on('node:stats', (p) => p.nodeId === 'S1' && (maxSlow = Math.max(maxSlow, p.stats.inFlight)))
    s.runAction('C', 'burst')
    s.advance(4000)
    const st = s.nodeState<BrokerState>('B')
    expect(st.lanes.S1.length).toBeGreaterThan(5)
    expect(st.lanes.S2 ?? []).toEqual([])
    expect(s.nodeStats('S2').ok).toBe(10)
    s.advance(60_000)
    expect(maxSlow).toBe(1)
    expect(s.nodeStats('S1').ok).toBe(10)
    expect(s.nodeState<BrokerState>('B').lanes.S1).toEqual([])
  })

  it('a down subscriber gets its lane drained after it comes back up', () => {
    const g = brokerGraph({ subs: [{}, { config: { up: false } }], client: { burstSize: 3 } })
    const s = sim(g)
    const fromB = sentFrom(s, 'B')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(fromB.filter((e) => e.to === 'S2')).toHaveLength(0)
    expect(s.nodeState<BrokerState>('B').lanes.S2).toHaveLength(3)
    expect(s.nodeStats('S1').ok).toBe(3)
    s.setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'S2' ? { ...n, config: { up: true } } : n)) })
    s.advance(10_000)
    expect(fromB.filter((e) => e.to === 'S2')).toHaveLength(3)
    expect(s.nodeStats('S2').ok).toBe(3)
    expect(s.nodeState<BrokerState>('B').lanes.S2).toEqual([])
  })

  it('a subscriber that goes down mid-hop nacks 503 and frees its slot', () => {
    const g = brokerGraph({ subs: [{}] })
    const s = sim(g)
    const atB = arrivedAt(s, 'B', 'response')
    const drops: SimEvents['message:dropped'][] = []
    s.on('message:dropped', (p) => drops.push(p))
    s.runAction('C', 'send1')
    s.advance(1000) // the subscriber polled; the event is in transit B→S (see timing: 700–1300ms)
    s.setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { up: false } } : n)) })
    s.advance(5000)
    expect(atB.map((r) => [r.status, r.code])).toEqual([['error', 503]])
    expect(drops.map((d) => [d.at, d.reason, d.code])).toEqual([['S1', 'down', 503]])
    const st = s.nodeState<BrokerState>('B')
    expect(st.inFlight.S1).toBe(0)
    expect(st.pending).toEqual({})
  })

  it('a subscriber that goes down mid-hop nacks via the engine drop and the lane drains', () => {
    const g: Graph = {
      nodes: [
        node('C', 'client', { rate: 0, kind: 'event', mix: [{ value: 'A', weight: 1 }], burstSize: 3 }),
        node('B', 'broker'),
        node('S', 'subscriber', { processingTime: 100, capacity: 1 }),
      ],
      edges: [edge('C', 'B'), edge('B', 'S')],
    }
    const s = sim(g)
    const atB = arrivedAt(s, 'B', 'response')
    s.runAction('C', 'burst')
    s.advance(1000) // the subscriber polled; the first event is in transit B→S
    s.setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'S' ? { ...n, config: { ...n.config, up: false } } : n)) })
    s.advance(2000) // the in-flight event reaches S (down), its processing drops 'down' and nacks to B
    expect(atB.map((r) => [r.status, r.code])).toContainEqual(['error', 503])
    expect(s.nodeState<BrokerState>('B').inFlight.S).toBe(0)
    s.setGraph(g) // back up
    s.advance(20_000)
    const st = s.nodeState<BrokerState>('B')
    expect(st.inFlight.S).toBe(0)
    expect(st.pending).toEqual({})
    expect(st.lanes.S).toEqual([])
    expect(s.nodeStats('S').ok).toBe(2)
  })

  it('pushes to queues fire-and-forget: broker → queue → worker processes the event', () => {
    const s = sim({
      nodes: [
        node('C', 'client', { rate: 0, kind: 'event', mix: [{ value: 'A', weight: 1 }], burstSize: 3 }),
        node('B', 'broker'),
        node('Q', 'queue'),
        node('W', 'worker', { processingTime: 2000, capacity: 1 }),
      ],
      edges: [edge('C', 'B'), edge('B', 'Q'), edge('Q', 'W')],
    })
    const fromB = sentFrom(s, 'B')
    s.runAction('C', 'burst')
    s.advance(1500)
    // All three are pushed at once, without waiting for any ack.
    expect(fromB.map((e) => e.to)).toEqual(['Q', 'Q', 'Q'])
    s.advance(20_000)
    expect(s.nodeStats('W').ok).toBe(3)
    const st = s.nodeState<BrokerState>('B')
    expect(st.pending).toEqual({})
    expect(st.lanes.Q ?? []).toEqual([])
  })
})

describe('subscriber', () => {
  it("emits: 'FacturaEmitida' produces a chained event at the next broker", () => {
    const s = sim({
      nodes: [
        node('C', 'client', { rate: 0, kind: 'event', mix: [{ value: 'PedidoCreado', weight: 1 }] }),
        node('B1', 'broker'),
        node('S', 'subscriber', { emits: 'FacturaEmitida' }),
        node('B2', 'broker'),
        node('S2', 'subscriber'),
        node('S3', 'subscriber'),
      ],
      edges: [edge('C', 'B1'), edge('B1', 'S'), edge('S', 'B2'), edge('B2', 'S2', ev('FacturaEmitida')), edge('B2', 'S3', ev('Otro'))],
    })
    const atB2 = arrivedAt(s, 'B2', 'event')
    const fromB2 = sentFrom(s, 'B2')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(atB2).toHaveLength(1)
    expect(atB2[0].meta.eventType).toBe('FacturaEmitida')
    expect(atB2[0].parentId).toBeDefined()
    expect(fromB2.map((e) => e.to)).toEqual(['S2'])
    expect(s.nodeStats('S2').ok).toBe(1)
    expect(s.nodeStats('S3').ok).toBe(0)
  })

  it('without emits it sends nothing downstream', () => {
    const s = sim({
      nodes: [node('C', 'client', { rate: 0, kind: 'event' }), node('B', 'broker'), node('S', 'subscriber'), node('B2', 'broker')],
      edges: [edge('C', 'B'), edge('B', 'S'), edge('S', 'B2')],
    })
    const fromS = sentFrom(s, 'S')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(s.nodeStats('S').ok).toBe(1)
    expect(fromS).toEqual([])
  })

  it('answers a request with 200 after processing', () => {
    const s = sim({
      nodes: [node('C', 'client', { rate: 0 }), node('S', 'subscriber', { processingTime: 400 })],
      edges: [edge('C', 'S')],
    })
    const atC = arrivedAt(s, 'C', 'response')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(atC.map((r) => [r.status, r.code])).toEqual([['ok', 200]])
  })
})
