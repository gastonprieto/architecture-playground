import { describe, expect, it } from 'vitest'
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
const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

/** Non-response messages sent by `from`, with send time and target. */
function sentFrom(s: Simulation, from: string): { msg: Message; to: string; at: number }[] {
  const out: { msg: Message; to: string; at: number }[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from && p.msg.kind !== 'response') out.push({ msg: p.msg, to: p.to, at: p.at })
  })
  return out
}

function responsesAt(s: Simulation, at: string): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === 'response') out.push(p.msg)
  })
  return out
}

function drops(s: Simulation): SimEvents['message:dropped'][] {
  const out: SimEvents['message:dropped'][] = []
  s.on('message:dropped', (p) => out.push(p))
  return out
}

interface QueueState {
  items: Message[]
}

/** C → Q → W1..Wn (+ optional DLQ). */
function queueGraph(opts: {
  queue?: Record<string, unknown>
  workers: Record<string, unknown>[]
  dlq?: boolean
  client?: Record<string, unknown>
}): Graph {
  const workers = opts.workers.map((c, i) => node(`W${i + 1}`, 'worker', c))
  const nodes = [node('C', 'client', { rate: 0, ...opts.client }), node('Q', 'queue', opts.queue), ...workers]
  const edges = [edge('C', 'Q'), ...workers.map((w) => edge('Q', w.id))]
  if (opts.dlq) {
    nodes.push(node('DLQ', 'dlq'))
    edges.push(edge('Q', 'DLQ'))
  }
  return { nodes, edges }
}

describe('catalog', () => {
  it('registers queue, worker and dlq with their metadata and config', () => {
    const meta = ['queue', 'worker', 'dlq'].map((t) => {
      const d = defaultRegistry.get(t)!
      return [d.label, d.icon, d.color]
    })
    expect(meta).toEqual([
      ['Cola', '📬', 'req'],
      ['Worker', '🛠️', 'ok'],
      ['DLQ', '☠️', 'err'],
    ])
    const q = defaultRegistry.get('queue')!
    expect(q.config.queueMax).toMatchObject({ type: 'number', label: 'Cola máx.', default: 50, min: 0, max: 500 })
    expect(q.config.maxRetries).toMatchObject({ type: 'number', label: 'Reintentos máx.', default: 3, min: 0, max: 10 })
    const w = defaultRegistry.get('worker')!
    expect(w.config.failRate).toMatchObject({ type: 'number', label: 'Tasa de fallo', default: 0, min: 0, max: 1 })
    expect(Object.keys(w.config)).toEqual(expect.arrayContaining(['up', 'processingTime', 'capacity', 'queueMax']))
    expect(defaultRegistry.get('dlq')!.actions!.reprocess.label).toBe('Reprocesar')
  })
})

describe('queue', () => {
  it('the client gets 202 at 2*HOP_MS regardless of worker time', () => {
    const s = sim(queueGraph({ workers: [{ processingTime: 5000 }] }))
    const res = responsesAt(s, 'C')
    const labels: string[] = []
    s.on('node:label', (p) => p.nodeId === 'Q' && labels.push(`${p.text}:${p.tone}`))
    s.runAction('C', 'send1')
    s.advance(2 * HOP_MS)
    expect(res.map((r) => [r.status, r.code])).toEqual([['ok', 202]])
    expect(s.metrics().p50).toBe(2 * HOP_MS)
    expect(labels).toContain('202:ok')
  })

  it('enqueues a derived message (parentId, attempt 0) and pushes it to a worker', () => {
    const s = sim(queueGraph({ workers: [{}] }))
    const fromC = sentFrom(s, 'C')
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'send1')
    s.advance(10_000)
    const req = fromC[0].msg
    expect(fromQ).toHaveLength(1)
    expect(fromQ[0]).toMatchObject({ to: 'W1', msg: { kind: 'message', parentId: req.id, attempt: 0, trail: ['Q'] } })
    expect(fromQ[0].msg.meta).toEqual(req.meta)
    expect(s.nodeStats('W1').ok).toBe(1)
    expect(s.nodeState<QueueState>('Q').items).toEqual([])
  })

  it('with 3 workers of capacity 1, at most 3 messages are in flight', () => {
    const s = sim(
      queueGraph({ workers: [{ capacity: 1 }, { capacity: 1 }, { capacity: 1 }], client: { burstSize: 12 } }),
    )
    let inFlight = 0
    let max = 0
    s.on('message:sent', (p) => {
      if (p.from === 'Q' && p.msg.kind === 'message') max = Math.max(max, ++inFlight)
    })
    s.on('message:arrived', (p) => {
      if (p.at === 'Q' && p.msg.kind === 'response' && p.msg.code !== 202) inFlight--
    })
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'burst')
    s.advance(1000)
    // Messages wait in the queue while the workers are busy.
    expect(s.nodeState<QueueState>('Q').items.length).toBeGreaterThan(0)
    s.advance(30_000)
    expect(max).toBe(3)
    expect(fromQ).toHaveLength(12)
    expect(['W1', 'W2', 'W3'].map((w) => s.nodeStats(w).ok)).toEqual([4, 4, 4])
    expect(s.nodeState<QueueState>('Q').items).toEqual([])
  })

  it('round-robins among free workers in output order', () => {
    const s = sim(queueGraph({ workers: [{ capacity: 5 }, { capacity: 5 }, { capacity: 5 }], client: { burstSize: 6 } }))
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(fromQ.map((e) => e.to)).toEqual(['W1', 'W2', 'W3', 'W1', 'W2', 'W3'])
  })

  it('workers that are down receive nothing', () => {
    const s = sim(queueGraph({ workers: [{ up: false }, {}], client: { burstSize: 6 } }))
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'burst')
    s.advance(20_000)
    expect(fromQ).toHaveLength(6)
    expect(fromQ.every((e) => e.to === 'W2')).toBe(true)
  })

  it('a worker coming back up gets the waiting messages', () => {
    const g = queueGraph({ workers: [{ up: false }], client: { burstSize: 3 } })
    const s = sim(g)
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(fromQ).toHaveLength(0)
    expect(s.nodeState<QueueState>('Q').items).toHaveLength(3)
    s.setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'W1' ? { ...n, config: { up: true } } : n)) })
    s.advance(10_000)
    expect(fromQ).toHaveLength(3)
    expect(s.nodeStats('W1').ok).toBe(3)
  })

  it('with failRate 1, maxRetries 2: each message is attempted 3 times, then lands in the DLQ', () => {
    const s = sim(queueGraph({ queue: { maxRetries: 2 }, workers: [{ failRate: 1 }], dlq: true }))
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'send1')
    s.advance(20_000)
    const toWorker = fromQ.filter((e) => e.to === 'W1')
    expect(toWorker.map((e) => e.msg.attempt)).toEqual([0, 1, 2])
    expect(fromQ.filter((e) => e.to === 'DLQ')).toHaveLength(1)
    const dead = s.nodeState<QueueState>('DLQ').items
    expect(dead).toHaveLength(1)
    expect(dead[0]).toMatchObject({ kind: 'message', attempt: 2 })
    expect(dead[0].trail.at(-1)).toBe('Q')
    expect(s.nodeStats('W1').errors).toBe(3)
  })

  it("without a DLQ the message is dropped 'no-dlq'", () => {
    const s = sim(queueGraph({ queue: { maxRetries: 1 }, workers: [{ failRate: 1 }] }))
    const d = drops(s)
    s.runAction('C', 'send1')
    s.advance(20_000)
    expect(d.map((e) => [e.at, e.reason, e.msg.kind])).toEqual([['Q', 'no-dlq', 'message']])
  })

  it('a Servicio consumer that goes down mid-hop nacks: the queue retries, then dead-letters', () => {
    const g: Graph = {
      nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue', { maxRetries: 1 }), node('S', 'service', { processingTime: 100 }), node('DLQ', 'dlq')],
      edges: [edge('C', 'Q'), edge('Q', 'S'), edge('Q', 'DLQ')],
    }
    const down = { ...g, nodes: g.nodes.map((n) => (n.id === 'S' ? { ...n, config: { ...n.config, up: false } } : n)) }
    const s = sim(g)
    const fromQ = sentFrom(s, 'Q')
    s.runAction('C', 'send1')
    s.advance(HOP_MS + 100) // the queue pushed attempt 0 to S
    expect(fromQ.map((e) => [e.to, e.msg.attempt])).toEqual([['S', 0]])
    s.setGraph(down)
    s.advance(2 * HOP_MS) // S drops 'down' and nacks; the retry waits for S to be up
    expect(s.nodeState<QueueState>('Q').items.map((m) => m.attempt)).toEqual([1])
    s.setGraph(g)
    s.advance(200) // next tick pushes attempt 1
    expect(fromQ.map((e) => [e.to, e.msg.attempt])).toEqual([['S', 0], ['S', 1]])
    s.setGraph(down)
    s.advance(5000)
    expect(fromQ.filter((e) => e.to === 'DLQ')).toHaveLength(1)
    expect(s.nodeState<QueueState>('DLQ').items).toHaveLength(1)
    expect(s.nodeState<{ inFlight: Record<string, number> }>('Q').inFlight.S).toBe(0)
  })

  it('a full queue answers 503', () => {
    const s = sim(queueGraph({ queue: { queueMax: 2 }, workers: [{ up: false }], client: { burstSize: 5 } }))
    const res = responsesAt(s, 'C')
    const d = drops(s)
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([202, 202, 503, 503, 503])
    expect(d.map((e) => [e.at, e.reason, e.code])).toEqual(Array(3).fill(['Q', 'queue-full', 503]))
    expect(s.nodeState<QueueState>('Q').items).toHaveLength(2)
  })

  it('enqueues incoming messages without replying', () => {
    const s = sim(queueGraph({ workers: [{ up: false }] }))
    const res = responsesAt(s, 'C')
    s.inject('Q', { id: 'x1', kind: 'message', meta: { path: '/' }, trail: ['C'], createdAt: 0 })
    s.advance(5000)
    expect(res).toEqual([])
    expect(s.nodeState<QueueState>('Q').items.map((m) => [m.id, m.attempt])).toEqual([['x1', 0]])
  })
})

describe('worker', () => {
  it('calls its dependencies and nacks (500) when one fails', () => {
    const s = sim({
      nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue', { maxRetries: 0 }), node('W', 'worker'), node('D', 'database', { up: false })],
      edges: [edge('C', 'Q'), edge('Q', 'W'), edge('W', 'D')],
    })
    const atQ = responsesAt(s, 'Q')
    const fromW = sentFrom(s, 'W')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(fromW.map((e) => [e.to, e.msg.kind])).toEqual([['D', 'request']])
    expect(atQ.map((r) => [r.status, r.code])).toEqual([['error', 500]])
  })

  it('acks (200) after a successful dependency call', () => {
    const s = sim({
      nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue'), node('W', 'worker'), node('D', 'database')],
      edges: [edge('C', 'Q'), edge('Q', 'W'), edge('W', 'D')],
    })
    const atQ = responsesAt(s, 'Q')
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(atQ.map((r) => [r.status, r.code])).toEqual([['ok', 200]])
    expect(s.nodeState<{ pending: Record<string, unknown> }>('W').pending).toEqual({})
  })
})

describe('dlq', () => {
  it("rejects a request with 'dlq-rejects-requests' (503)", () => {
    const s = sim({ nodes: [node('C', 'client', { rate: 0 }), node('DLQ', 'dlq')], edges: [edge('C', 'DLQ')] })
    const d = drops(s)
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.advance(3 * HOP_MS)
    expect(d.map((e) => [e.at, e.reason, e.code])).toEqual([['DLQ', 'dlq-rejects-requests', 503]])
    expect(res.map((r) => [r.status, r.code])).toEqual([['error', 503]])
    expect(s.nodeState<QueueState>('DLQ').items).toEqual([])
  })

  it('stores events without replying', () => {
    const s = sim({ nodes: [node('C', 'client', { rate: 0, kind: 'event' }), node('DLQ', 'dlq')], edges: [edge('C', 'DLQ')] })
    const res = responsesAt(s, 'C')
    s.runAction('C', 'send1')
    s.advance(3 * HOP_MS)
    expect(res).toEqual([])
    expect(s.nodeState<QueueState>('DLQ').items.map((m) => m.kind)).toEqual(['event'])
  })

  it('reprocess empties the DLQ and messages re-enter the queue', () => {
    const g = queueGraph({ queue: { maxRetries: 0 }, workers: [{ failRate: 1 }], dlq: true, client: { burstSize: 2 } })
    const s = sim(g)
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(s.nodeState<QueueState>('DLQ').items).toHaveLength(2)

    // Fix the poison: the worker stops failing, then reprocess.
    s.setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'W1' ? { ...n, config: { failRate: 0 } } : n)) })
    const fromDlq = sentFrom(s, 'DLQ')
    s.runAction('DLQ', 'reprocess')
    expect(s.nodeState<QueueState>('DLQ').items).toEqual([])
    expect(fromDlq.map((e) => [e.to, e.msg.kind, e.msg.attempt, e.msg.trail])).toEqual([
      ['Q', 'message', 0, ['DLQ']],
      ['Q', 'message', 0, ['DLQ']],
    ])
    s.advance(10_000)
    expect(s.nodeStats('W1').ok).toBe(2)
    expect(s.nodeState<QueueState>('DLQ').items).toEqual([])
    expect(s.nodeState<QueueState>('Q').items).toEqual([])
  })
})
