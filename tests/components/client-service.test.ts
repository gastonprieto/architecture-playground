import { describe, expect, it } from 'vitest'
import { client } from '../../src/components/client'
import { defaultRegistry } from '../../src/components/index'
import { HOP_MS, Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ nodes, edges })

const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

/** Messages sent by `from`, with the sim time they were sent at. */
function sentFrom(s: Simulation, from: string): { msg: Message; at: number; to: string }[] {
  const out: { msg: Message; at: number; to: string }[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from) out.push({ msg: p.msg, at: p.at, to: p.to })
  })
  return out
}

/** Responses arriving at `at`. */
function responsesAt(s: Simulation, at: string): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === 'response') out.push(p.msg)
  })
  return out
}

describe('defaultRegistry', () => {
  it('registers client, service and database with their catalog metadata', () => {
    const meta = ['client', 'service', 'database'].map((t) => {
      const d = defaultRegistry.get(t)!
      return [d.type, d.label, d.icon, d.color]
    })
    expect(meta).toEqual([
      ['client', 'Cliente', '💻', 'req'],
      ['service', 'Servicio', '⚙️', 'ok'],
      ['database', 'Base de datos', '🗄️', 'db'],
    ])
    expect(defaultRegistry.get('client')!.recordsMetrics).toBe(true)
  })
})

describe('client', () => {
  it('client rate 2 sends ~2 req/s', () => {
    const s = sim(graph([node('C', 'client', { rate: 2 }), node('D', 'database')], [edge('C', 'D')]))
    const sent = sentFrom(s, 'C')
    s.advance(20_000)
    const requests = sent.filter((e) => e.msg.kind === 'request')
    expect(requests.length).toBeGreaterThanOrEqual(38)
    expect(requests.length).toBeLessThanOrEqual(42)
    expect(requests.every((e) => e.msg.meta.clientId === 'C' && e.msg.meta.path === '/')).toBe(true)
  })

  it('burst sends burstSize over 1s', () => {
    const s = sim(graph([node('C', 'client', { rate: 0, burstSize: 20 }), node('D', 'database')], [edge('C', 'D')]))
    const sent = sentFrom(s, 'C')
    s.runAction('C', 'burst')
    s.advance(999)
    const times = sent.map((e) => e.at)
    expect(times).toHaveLength(20)
    expect(times).toEqual(Array.from({ length: 20 }, (_, i) => i * 50))
    s.advance(5000)
    expect(sent).toHaveLength(20)
  })

  it('send1 sends exactly one request', () => {
    const s = sim(graph([node('C', 'client', { rate: 0 }), node('D', 'database')], [edge('C', 'D')]))
    const sent = sentFrom(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(sent).toHaveLength(1)
  })

  it('rate field max is 50 and burstSize max is 200', () => {
    const { rate, burstSize } = client.config
    expect(rate).toMatchObject({ type: 'number', min: 0, max: 50, default: 2 })
    expect(burstSize).toMatchObject({ type: 'number', min: 1, max: 200, default: 20 })
  })

  it('exposes the catalog config fields and actions', () => {
    expect(client.config.kind).toMatchObject({
      type: 'select',
      default: 'request',
      options: [
        { value: 'request', label: 'Request' },
        { value: 'event', label: 'Evento' },
      ],
    })
    expect(client.config.mix).toMatchObject({ type: 'mix', default: [{ value: '/', weight: 1 }] })
    expect(client.actions!.send1.label).toBe('Enviar 1')
    expect(client.actions!.burst.label).toBe('Ráfaga')
  })

  it('event kind sends events with meta.eventType from the weighted mix', () => {
    const mix = [
      { value: 'order.created', weight: 3 },
      { value: 'order.paid', weight: 1 },
    ]
    const s = sim(graph([node('C', 'client', { kind: 'event', rate: 0, mix, burstSize: 200 }), node('D', 'database')], [edge('C', 'D')]))
    const sent = sentFrom(s, 'C')
    s.runAction('C', 'burst')
    s.advance(1000)
    expect(sent).toHaveLength(200)
    expect(sent.every((e) => e.msg.kind === 'event' && e.msg.meta.path === undefined)).toBe(true)
    const created = sent.filter((e) => e.msg.meta.eventType === 'order.created').length
    const paid = sent.filter((e) => e.msg.meta.eventType === 'order.paid').length
    expect(created + paid).toBe(200)
    expect(created).toBeGreaterThan(paid * 2)
  })

  it("client without outputs drops 'no-output'", () => {
    const s = sim(graph([node('C', 'client', { rate: 0 })]))
    const drops: SimEvents['message:dropped'][] = []
    s.on('message:dropped', (p) => drops.push(p))
    s.runAction('C', 'send1')
    s.advance(1000)
    expect(drops.map((d) => [d.at, d.reason])).toEqual([['C', 'no-output']])
    expect(s.nodeStats('C').errors).toBe(1)
  })
})

describe('client receiving traffic', () => {
  it("drops a request sent to it with 'client-rejects-requests' and answers 503", () => {
    const s = sim(graph([node('C1', 'client', { rate: 0 }), node('C2', 'client', { rate: 0 })], [edge('C1', 'C2')]))
    const drops: SimEvents['message:dropped'][] = []
    s.on('message:dropped', (p) => drops.push(p))
    const res = responsesAt(s, 'C1')
    s.runAction('C1', 'send1')
    s.advance(3 * HOP_MS)
    expect(drops.map((d) => [d.at, d.reason, d.code])).toEqual([['C2', 'client-rejects-requests', 503]])
    expect(res.map((r) => [r.status, r.code])).toEqual([['error', 503]])
  })

  it('drops events sent to it too', () => {
    const s = sim(graph([node('C1', 'client', { rate: 0, kind: 'event' }), node('C2', 'client', { rate: 0 })], [edge('C1', 'C2')]))
    const drops: SimEvents['message:dropped'][] = []
    s.on('message:dropped', (p) => drops.push(p))
    s.runAction('C1', 'send1')
    s.advance(3 * HOP_MS)
    expect(drops.map((d) => [d.at, d.reason, d.msg.kind])).toEqual([['C2', 'client-rejects-requests', 'event']])
  })
})

describe('service and database', () => {
  it('client→service→db completes ok and records latency', () => {
    const s = sim(
      graph(
        [node('C', 'client', { rate: 0 }), node('S', 'service'), node('D', 'database')],
        [edge('C', 'S'), edge('S', 'D')],
      ),
    )
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => [r.status, r.code])).toEqual([['ok', 200]])
    // 4 hops + service 400 + db 300
    const expected = 4 * HOP_MS + 400 + 300
    expect(s.metrics()).toMatchObject({ p50: expected, p95: expected, errorRate: 0 })
    expect(s.nodeStats('S').ok).toBe(1)
    expect(s.nodeStats('D').ok).toBe(1)
  })

  it('service without outputs processes and replies 200', () => {
    const s = sim(graph([node('C', 'client', { rate: 0 }), node('S', 'service')], [edge('C', 'S')]))
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([200])
    expect(s.metrics().p50).toBe(2 * HOP_MS + 400)
  })

  it('child requests carry parentId and the same meta', () => {
    const s = sim(
      graph(
        [node('C', 'client', { rate: 0 }), node('S', 'service'), node('D', 'database')],
        [edge('C', 'S'), edge('S', 'D')],
      ),
    )
    const fromC = sentFrom(s, 'C')
    const fromS = sentFrom(s, 'S')
    s.runAction('C', 'send1')
    s.advance(10_000)
    const parent = fromC[0].msg
    const child = fromS.find((e) => e.msg.kind === 'request')!.msg
    expect(child.parentId).toBe(parent.id)
    expect(child.meta).toEqual(parent.meta)
    expect(child.trail).toEqual(['S'])
    expect(s.nodeState<{ pending: Record<string, unknown> }>('S').pending).toEqual({})
  })

  const fanOut = (mode: string) =>
    graph(
      [
        node('C', 'client', { rate: 0 }),
        node('S', 'service', { mode }),
        node('D1', 'database', { processingTime: 300 }),
        node('D2', 'database', { processingTime: 1000 }),
      ],
      [edge('C', 'S'), edge('S', 'D1'), edge('S', 'D2')],
    )

  it('parallel waits for the slowest dependency; sequential sums them', () => {
    const par = sim(fanOut('parallel'))
    par.runAction('C', 'send1')
    par.advance(8000)
    expect(par.metrics().p50).toBe(4 * HOP_MS + 400 + 1000)

    const seq = sim(fanOut('sequential'))
    const seqSent = sentFrom(seq, 'S')
    seq.runAction('C', 'send1')
    seq.advance(8000)
    expect(seq.metrics().p50).toBe(6 * HOP_MS + 400 + 300 + 1000)
    // D2 is called only after D1 answered
    const toD2 = seqSent.find((e) => e.to === 'D2')!
    expect(toD2.at).toBe(HOP_MS + 400 + 2 * HOP_MS + 300)
  })

  it('dependency error yields 502 to client', () => {
    const s = sim(
      graph(
        [node('C', 'client', { rate: 0 }), node('S', 'service'), node('D', 'database', { up: false })],
        [edge('C', 'S'), edge('S', 'D')],
      ),
    )
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.advance(6000)
    expect(res.map((r) => [r.status, r.code])).toEqual([['error', 502]])
    expect(s.metrics().errorRate).toBe(1)
    expect(s.nodeStats('S').errors).toBe(1)
  })

  it('sequential stops at the first failing dependency', () => {
    const s = sim(
      graph(
        [
          node('C', 'client', { rate: 0 }),
          node('S', 'service', { mode: 'sequential' }),
          node('D1', 'database', { up: false }),
          node('D2', 'database'),
        ],
        [edge('C', 'S'), edge('S', 'D1'), edge('S', 'D2')],
      ),
    )
    const fromS = sentFrom(s, 'S')
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(fromS.some((e) => e.to === 'D2')).toBe(false)
    expect(res.map((r) => r.code)).toEqual([502])
  })

  it('parallel with one failing dependency still waits for all, then 502', () => {
    const s = sim(
      graph(
        [
          node('C', 'client', { rate: 0 }),
          node('S', 'service'),
          node('D1', 'database', { up: false }),
          node('D2', 'database', { processingTime: 1000 }),
        ],
        [edge('C', 'S'), edge('S', 'D1'), edge('S', 'D2')],
      ),
    )
    s.runAction('C', 'send1')
    s.advance(8000)
    expect(s.metrics()).toMatchObject({ errorRate: 1, p50: 4 * HOP_MS + 400 + 1000 })
  })

  it('a Servicio A ↔ Servicio B cycle trips the loop guard and the client gets an error', () => {
    const s = sim(
      graph(
        [node('C', 'client', { rate: 0 }), node('A', 'service', { processingTime: 10, capacity: 100 }), node('B', 'service', { processingTime: 10, capacity: 100 })],
        [edge('C', 'A'), edge('A', 'B'), edge('B', 'A')],
      ),
    )
    const drops: SimEvents['message:dropped'][] = []
    s.on('message:dropped', (p) => drops.push(p))
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    expect(() => s.advance(120_000)).not.toThrow()
    expect(drops.filter((d) => d.reason === 'loop').length).toBeGreaterThan(0)
    expect(res.map((r) => r.status)).toEqual(['error'])
    // The simulation keeps running afterwards.
    s.runAction('C', 'send1')
    s.advance(120_000)
    expect(res.map((r) => r.status)).toEqual(['error', 'error'])
  })

  it('database processingTime defaults to 300 and service mode to parallel', () => {
    const db = defaultRegistry.get('database')!
    const svc = defaultRegistry.get('service')!
    expect(db.config.processingTime).toMatchObject({ type: 'number', default: 300 })
    expect(svc.config.mode).toMatchObject({
      type: 'select',
      default: 'parallel',
      options: [
        { value: 'parallel', label: 'Paralelo' },
        { value: 'sequential', label: 'Secuencial' },
      ],
    })
    expect(svc.config.processingTime).toMatchObject({ default: 400 })
  })
})
