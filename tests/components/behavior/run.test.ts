import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../../src/components/index'
import { defaultConfig } from '../../../src/engine/registry'
import { Simulation } from '../../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../../src/engine/types'

/*
 * Engine-level tests: real Simulation, real components. Timeline reminders: one hop = 600 ms;
 * the client sends at t=0, so a request reaches its first node at 600.
 */

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { name: id, ...config },
})
const edge = (source: string, target: string, id = `${source}-${target}`): GraphEdge => ({ id, source, target })
const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ nodes, edges })

/** A Servicio with a 100 ms processing time and the given DSL. */
const svc = (id: string, behavior: string, extra: Record<string, unknown> = {}) =>
  node(id, 'service', { processingTime: 100, behavior, ...extra })
const client = (extra: Record<string, unknown> = {}) => node('C', 'client', extra)

interface Seen {
  at: string
  time: number
  msg: Message
}

function run(g: Graph) {
  const s = new Simulation(g, { seed: 3, registry: defaultRegistry })
  const arrived: Seen[] = []
  const sent: (Seen & { to: string })[] = []
  s.on('message:arrived', (p) => arrived.push({ at: p.at, time: s.now, msg: p.msg }))
  s.on('message:sent', (p) => sent.push({ at: p.from, to: p.to, time: p.at, msg: p.msg }))
  return {
    s,
    send: (n = 1) => {
      for (let i = 0; i < n; i++) s.runAction('C', 'send1')
    },
    /** Requests/messages/events that reached `at`. */
    arrivals: (at: string) => arrived.filter((e) => e.at === at && e.msg.kind !== 'response' && e.msg.kind !== 'poll'),
    /** Responses that reached `at`. */
    responses: (at: string) => arrived.filter((e) => e.at === at && e.msg.kind === 'response'),
    /** Responses `from` sent. */
    repliesFrom: (from: string) => sent.filter((e) => e.at === from && e.msg.kind === 'response'),
  }
}

const codesAt = (list: Seen[]) => list.map((e) => [e.msg.status, e.msg.code, e.time])

describe('behavior: call', () => {
  it('sends a child request with the path and replies 200 after it answers', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  call T /x'), svc('T', '')], [edge('C', 'S'), edge('S', 'T')]))
    t.send()
    t.s.advance(5000)
    const [atT] = t.arrivals('T')
    expect(atT.time).toBe(1300) // S starts at 700 (600 hop + 100 processing), one hop to T
    expect(atT.msg.meta.path).toBe('/x')
    expect(atT.msg.parentId).toBe(t.arrivals('S')[0].msg.id)
    // T answers at 1400, S gets it at 2000 and replies; C at 2600.
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 2600]])
    expect(t.s.nodeStats('S').inFlight).toBe(0)
  })

  it('a failing child ends the handler with 502 by default', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  call T /x\n  reply 201'), svc('T', '', { up: false })], [edge('C', 'S'), edge('S', 'T')]))
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([['error', 502, 2500]])
    expect(t.s.nodeStats('S').inFlight).toBe(0)
  })

  it('`or reply 402` replies 402 when the child fails', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  call T /x or reply 402\n  reply 201'), svc('T', '', { up: false })], [edge('C', 'S'), edge('S', 'T')]))
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([['error', 402, 2500]])
  })

  it('`or continue` goes on with the next step when the child fails', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  call T /x or continue\n  reply 201'), svc('T', '', { up: false })], [edge('C', 'S'), edge('S', 'T')]))
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([['ok', 201, 2500]])
  })

  it('`nowait` replies right away and ignores the late child response', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  call T /x nowait'), svc('T', '')], [edge('C', 'S'), edge('S', 'T')]))
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 1300]])
    expect(t.responses('S').map((e) => e.time)).toEqual([2000]) // T's answer did arrive…
    expect(t.repliesFrom('S')).toHaveLength(1) // …and was not forwarded nor answered again
    expect(t.s.nodeState<{ behaviorPending: object }>('S').behaviorPending).toEqual({})
    expect(t.s.nodeStats('S')).toMatchObject({ inFlight: 0, ok: 1, errors: 0 })
  })
})

describe('behavior: query, enqueue, publish', () => {
  it('query sends a request with the same meta and waits for it', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  query DB'), node('DB', 'database', { processingTime: 100 })], [edge('C', 'S'), edge('S', 'DB')]))
    t.send()
    t.s.advance(5000)
    const [atDb] = t.arrivals('DB')
    expect(atDb.msg.kind).toBe('request')
    expect(atDb.msg.meta.path).toBe('/')
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 2600]])
  })

  it('enqueue waits only for the 202, not for the worker', () => {
    const t = run(
      graph(
        [client(), svc('S', 'on request:\n  enqueue Q'), node('Q', 'queue'), node('W', 'worker', { processingTime: 5000 })],
        [edge('C', 'S'), edge('S', 'Q'), edge('Q', 'W')],
      ),
    )
    t.send()
    t.s.advance(3000)
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 2500]])
    expect(t.arrivals('W')).toHaveLength(1)
    expect(t.repliesFrom('W')).toHaveLength(0) // still processing
  })

  it('publish sends the event type to the broker, which fans it out', () => {
    const t = run(
      graph(
        [client(), svc('S', 'on request:\n  publish OrdenCreada'), node('B', 'broker'), node('SUB', 'subscriber', { processingTime: 100 })],
        [edge('C', 'S'), edge('S', 'B'), edge('B', 'SUB')],
      ),
    )
    t.send()
    t.s.advance(5000)
    const [atB] = t.arrivals('B')
    expect(atB.msg).toMatchObject({ kind: 'request', meta: { eventType: 'OrdenCreada' } })
    expect(t.arrivals('SUB').map((e) => [e.msg.kind, e.msg.meta.eventType])).toEqual([['event', 'OrdenCreada']])
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 2500]])
  })

  it('publish waits for the 202 of every connected broker', () => {
    const t = run(
      graph([client(), svc('S', 'on request:\n  publish X\n  reply 201'), node('B1', 'broker'), node('B2', 'broker')], [edge('C', 'S'), edge('S', 'B1'), edge('S', 'B2')]),
    )
    t.send()
    t.s.advance(5000)
    expect(t.arrivals('B1')).toHaveLength(1)
    expect(t.arrivals('B2')).toHaveLength(1)
    expect(codesAt(t.responses('C'))).toEqual([['ok', 201, 2500]])
  })
})

describe('behavior: parallel', () => {
  const parallelGraph = (dsl: string, tUp: boolean) =>
    graph(
      [client(), svc('S', dsl), svc('T', '', { up: tUp }), node('DB', 'database', { processingTime: 1000 })],
      [edge('C', 'S'), edge('S', 'T'), edge('S', 'DB')],
    )

  it('waits for every branch', () => {
    const t = run(parallelGraph('on request:\n  parallel:\n    call T /x\n    query DB', true))
    t.send()
    t.s.advance(6000)
    // T answers S at 2000, DB at 2900 (700 + 600 + 1000 + 600).
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 3500]])
  })

  it('a failed branch makes the block reply 502, but only after all finish', () => {
    const t = run(parallelGraph('on request:\n  parallel:\n    call T /x\n    query DB\n  reply 201', false))
    t.send()
    t.s.advance(6000)
    expect(codesAt(t.responses('C'))).toEqual([['error', 502, 3500]])
    expect(t.s.nodeStats('S').inFlight).toBe(0)
  })

  it.each([
    ['fail 100%', 'error', 500],
    ['reply 201', 'ok', 201],
  ])('`%s` before a sibling in parallel ends the handler: later branches send nothing', (first, status, code) => {
    const t = run(parallelGraph(`on request:\n  parallel:\n    ${first}\n    call T /x\n    query DB`, true))
    t.send()
    t.s.advance(6000)
    expect(codesAt(t.responses('C'))).toEqual([[status, code, 1300]])
    expect(t.arrivals('T')).toHaveLength(0)
    expect(t.arrivals('DB')).toHaveLength(0)
    expect(t.repliesFrom('S')).toHaveLength(1)
    expect(t.s.nodeStats('S').inFlight).toBe(0)
  })

  it('`or reply` inside parallel ends at once; the sibling response arriving later is ignored', () => {
    const t = run(parallelGraph('on request:\n  parallel:\n    call T /x or reply 402\n    query DB', false))
    t.send()
    t.s.advance(6000)
    expect(codesAt(t.responses('C'))).toEqual([['error', 402, 2500]])
    expect(t.responses('S').map((e) => e.time)).toEqual([1900, 2900])
    expect(t.repliesFrom('S')).toHaveLength(1)
    expect(t.s.nodeState<{ behaviorPending: object }>('S').behaviorPending).toEqual({})
    expect(t.s.nodeStats('S')).toMatchObject({ inFlight: 0, ok: 0, errors: 1 })
  })
})

describe('behavior: wait, fail, reply', () => {
  const single = (dsl: string, extra: Record<string, unknown> = {}) =>
    run(graph([client(), svc('S', dsl, extra), svc('T', '')], [edge('C', 'S'), edge('S', 'T')]))

  it('wait holds the handler for that many sim-ms', () => {
    const t = single('on request:\n  wait 500')
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([['ok', 200, 1800]])
  })

  it('fail 100% replies 500; a custom code is used; fail 0% never fires', () => {
    const a = single('on request:\n  fail 100%\n  reply 201')
    a.send()
    a.s.advance(5000)
    expect(codesAt(a.responses('C'))).toEqual([['error', 500, 1300]])

    const b = single('on request:\n  fail 100% 503')
    b.send()
    b.s.advance(5000)
    expect(codesAt(b.responses('C'))).toEqual([['error', 503, 1300]])

    const c = single('on request:\n  fail 0%\n  reply 201')
    c.send()
    c.s.advance(5000)
    expect(codesAt(c.responses('C'))).toEqual([['ok', 201, 1300]])
  })

  it('reply ends the handler: later steps do not run', () => {
    const t = single('on request:\n  reply 201\n  call T /x')
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([['ok', 201, 1300]])
    expect(t.arrivals('T')).toHaveLength(0)
  })
})

describe('behavior: handler selection', () => {
  const routed = (path: string) => {
    const t = run(
      graph([
        client({ mix: [{ value: path, weight: 1 }] }),
        svc('S', 'on request /a:\n  reply 201\non request /a/b:\n  reply 202\non request:\n  reply 203'),
      ], [edge('C', 'S')]),
    )
    t.send()
    t.s.advance(3000)
    return t.responses('C').map((e) => e.msg.code)
  }

  it('the longest matching prefix wins; `on request` is the default', () => {
    expect(routed('/a/b/c')).toEqual([202])
    expect(routed('/a/x')).toEqual([201])
    expect(routed('/zz')).toEqual([203])
  })

  it('no matching request handler → 404', () => {
    const t = run(graph([client(), svc('S', 'on request /ordenes:\n  reply 201')], [edge('C', 'S')]))
    t.send()
    t.s.advance(3000)
    expect(codesAt(t.responses('C'))).toEqual([['error', 404, 1300]])
  })

  const eventSim = (eventType: string, dsl: string) => {
    const t = run(
      graph([client({ kind: 'event', mix: [{ value: eventType, weight: 1 }] }), node('SUB', 'subscriber', { processingTime: 100, behavior: dsl })], [edge('C', 'SUB')]),
    )
    t.send()
    t.s.advance(3000)
    return t
  }

  it('`on event Tipo` matches the exact event type, else the default `on event`', () => {
    const dsl = 'on event A:\n  reply 503\non event:\n  reply 200'
    expect(codesAt(eventSim('A', dsl).responses('C'))).toEqual([['error', 503, 1300]])
    expect(codesAt(eventSim('B', dsl).responses('C'))).toEqual([['ok', 200, 1300]])
  })

  it('event types match after NFC normalization (quoted header)', () => {
    const t = eventSim('Pagó'.normalize('NFC'), `on event "${'Pagó'.normalize('NFD')}":\n  reply 503`)
    expect(codesAt(t.responses('C'))).toEqual([['error', 503, 1300]])
  })

  it('no matching event handler → silent ack', () => {
    expect(codesAt(eventSim('X', 'on event Y:\n  fail 100%').responses('C'))).toEqual([['ok', 200, 1300]])
  })

  it('a Servicio can handle events from a Broker', () => {
    const t = run(
      graph(
        [client(), svc('S', 'on request:\n  publish Hecho'), node('B', 'broker'), svc('S2', 'on event Hecho:\n  query DB'), node('DB', 'database', { processingTime: 100 })],
        [edge('C', 'S'), edge('S', 'B'), edge('B', 'S2'), edge('S2', 'DB')],
      ),
    )
    t.send()
    t.s.advance(6000)
    expect(t.arrivals('DB')).toHaveLength(1)
    expect(t.responses('B').filter((e) => e.msg.status === 'ok')).toHaveLength(1) // the ack from S2
  })
})

describe('behavior: messages from a queue', () => {
  const queued = (workerDsl: string) => {
    const t = run(
      graph(
        [client(), node('Q', 'queue', { maxRetries: 2 }), node('W', 'worker', { processingTime: 100, behavior: workerDsl }), node('DB', 'database', { processingTime: 100 })],
        [edge('C', 'Q'), edge('Q', 'W'), edge('W', 'DB')],
      ),
    )
    t.send()
    t.s.advance(20_000)
    return t
  }

  it('`fail 100%` in `on message` nacks, so the queue retries', () => {
    const t = queued('on message:\n  fail 100%')
    expect(t.arrivals('W')).toHaveLength(3) // first try + 2 retries
    expect(t.responses('Q').filter((e) => e.msg.status === 'error')).toHaveLength(3)
    expect(t.s.nodeStats('W').inFlight).toBe(0)
  })

  it('`on message` runs its steps and acks at the end', () => {
    const t = queued('on message:\n  query DB')
    expect(t.arrivals('W')).toHaveLength(1)
    expect(t.arrivals('DB')).toHaveLength(1)
    expect(t.responses('Q').map((e) => e.msg.status)).toEqual(['ok'])
  })

  it('no `on message` handler → ack', () => {
    const t = queued('on request:\n  fail 100%')
    expect(t.arrivals('W')).toHaveLength(1)
    expect(t.responses('Q').map((e) => e.msg.status)).toEqual(['ok'])
  })

  it('a failing step in `on message` nacks (default 502)', () => {
    const t = run(
      graph(
        [client(), node('Q', 'queue', { maxRetries: 0 }), node('W', 'worker', { processingTime: 100, behavior: 'on message:\n  query DB' }), node('DB', 'database', { up: false })],
        [edge('C', 'Q'), edge('Q', 'W'), edge('W', 'DB')],
      ),
    )
    t.send()
    t.s.advance(10_000)
    expect(t.responses('Q').map((e) => [e.msg.status, e.msg.code])).toEqual([['error', 502]])
  })
})

describe('behavior: capacity and program lifecycle', () => {
  it('holds the slot for the whole handler (capacity 1 queues the second request)', () => {
    const t = run(graph([client(), svc('S', 'on request:\n  wait 1000', { capacity: 1 })], [edge('C', 'S')]))
    t.send(2)
    t.s.advance(800)
    expect(t.s.nodeStats('S')).toMatchObject({ inFlight: 1, queued: 1 })
    t.s.advance(5000)
    // First: 700 → 1700, C at 2300. Second starts at 1700: 1800 → 2800, C at 3400.
    expect(codesAt(t.responses('C'))).toEqual([
      ['ok', 200, 2300],
      ['ok', 200, 3400],
    ])
    expect(t.s.nodeStats('S')).toMatchObject({ inFlight: 0, queued: 0 })
  })

  it('a DSL with errors falls back to the default behavior', () => {
    const t = run(
      graph([client(), svc('S', 'on request:\n  query Nope\n  reply 201'), node('DB', 'database', { processingTime: 100 })], [edge('C', 'S'), edge('S', 'DB')]),
    )
    t.send()
    t.s.advance(5000)
    expect(t.arrivals('DB')).toHaveLength(1) // default: calls every output
    expect(t.responses('C').map((e) => e.msg.code)).toEqual([200])
  })

  it('renaming a target invalidates the DSL and falls back to the default', () => {
    const nodes = (dbName: string) => [
      client(),
      svc('S', 'on request:\n  query DB\n  reply 201'),
      node('DB', 'database', { processingTime: 100, name: dbName }),
    ]
    const edges = [edge('C', 'S'), edge('S', 'DB')]
    const t = run(graph(nodes('DB'), edges))
    t.send()
    t.s.advance(3000)
    t.s.setGraph(graph(nodes('Base'), edges))
    t.send()
    t.s.advance(3000)
    expect(t.responses('C').map((e) => e.msg.code)).toEqual([201, 200])
  })

  it('a DSL change mid-flight: the running handler keeps its program, new arrivals use the new one', () => {
    const nodes = (dsl: string) => [client(), svc('S', dsl)]
    const edges = [edge('C', 'S')]
    const t = run(graph(nodes('on request:\n  wait 1000\n  reply 201'), edges))
    t.send()
    t.s.advance(1000) // first handler is waiting (700 → 1700)
    t.s.setGraph(graph(nodes('on request:\n  reply 202'), edges))
    t.send()
    t.s.advance(5000)
    expect(codesAt(t.responses('C'))).toEqual([
      ['ok', 201, 2300],
      ['ok', 202, 2300],
    ])
  })

  it('an output connected twice is not ambiguous', () => {
    const t = run(
      graph(
        [client(), svc('S', 'on request:\n  query DB\n  reply 201'), node('DB', 'database', { processingTime: 100 })],
        [edge('C', 'S'), edge('S', 'DB', 'e1'), edge('S', 'DB', 'e2')],
      ),
    )
    t.send()
    t.s.advance(5000)
    expect(t.arrivals('DB')).toHaveLength(1)
    expect(t.responses('C').map((e) => e.msg.code)).toEqual([201])
  })

  it('children copy the original meta, clientColor included', () => {
    const t = run(
      graph(
        [client({ color: '#d97706' }), svc('S', 'on request:\n  query DB\n  publish X'), node('DB', 'database', { processingTime: 100 }), node('B', 'broker')],
        [edge('C', 'S'), edge('S', 'DB'), edge('S', 'B')],
      ),
    )
    t.send()
    t.s.advance(5000)
    expect(t.arrivals('DB')[0].msg.meta).toMatchObject({ clientColor: '#d97706', clientId: 'C' })
    expect(t.arrivals('B')[0].msg.meta).toMatchObject({ clientColor: '#d97706', clientId: 'C', eventType: 'X' })
  })

  it('a valid DSL replaces the Suscriptor `emits`', () => {
    const t = run(
      graph(
        [client({ kind: 'event', mix: [{ value: 'E', weight: 1 }] }), node('SUB', 'subscriber', { processingTime: 100, emits: 'Z', behavior: 'on event:\n  reply 200' }), node('B', 'broker')],
        [edge('C', 'SUB'), edge('SUB', 'B')],
      ),
    )
    t.send()
    t.s.advance(5000)
    expect(t.arrivals('B')).toHaveLength(0)
    expect(t.responses('C').map((e) => e.msg.code)).toEqual([200])
  })
})

describe('behavior field', () => {
  it('Servicio, Worker and Suscriptor default to an empty behavior', () => {
    for (const type of ['service', 'worker', 'subscriber']) {
      const def = defaultRegistry.get(type)!
      expect(def.config.behavior).toEqual({ type: 'behavior', label: 'Comportamiento', default: '' })
      expect(defaultConfig(def).behavior).toBe('')
    }
  })

  it('a blank behavior keeps the default behavior', () => {
    const t = run(graph([client(), svc('S', '  \n # comment\n'), node('DB', 'database', { processingTime: 100 })], [edge('C', 'S'), edge('S', 'DB')]))
    t.send()
    t.s.advance(5000)
    expect(t.arrivals('DB')).toHaveLength(1)
    expect(t.responses('C').map((e) => e.msg.code)).toEqual([200])
  })
})

describe('behavior: target removed while a child is pending', () => {
  const g0 = (behavior: string) =>
    graph(
      [client(), svc('S', behavior, { capacity: 1 }), svc('T', '', { processingTime: 3000 }), svc('T2', '')],
      [edge('C', 'S'), edge('S', 'T')],
    )

  it('the pending child fails at once (502), the slot is freed and the next request is served', () => {
    const t = run(g0('on request:\n  call T /x\n  reply 201'))
    t.send()
    t.s.advance(2000) // child reached T at 1300; T busy until 4300
    expect(t.s.nodeStats('S').inFlight).toBe(1)
    // Delete T and wire S to a new node also named T.
    const { nodes, edges } = g0('on request:\n  call T /x\n  reply 201')
    t.s.setGraph({
      nodes: nodes.filter((n) => n.id !== 'T').map((n) => (n.id === 'T2' ? { ...n, config: { ...n.config, name: 'T' } } : n)),
      edges: [edges[0], edge('S', 'T2')],
    })
    t.s.advance(200)
    expect(t.s.nodeStats('S').inFlight).toBe(0)
    expect(t.repliesFrom('S').map((e) => e.msg.code)).toEqual([502])
    t.s.advance(1000)
    expect(codesAt(t.responses('C'))[0].slice(0, 2)).toEqual(['error', 502])
    t.send()
    t.s.advance(5000)
    expect(t.responses('C').map((e) => e.msg.code)).toEqual([502, 201])
    expect(t.arrivals('T2')).toHaveLength(1)
  })

  it('`or continue` goes on when the target is deleted', () => {
    const t = run(g0('on request:\n  call T /x or continue\n  reply 201'))
    t.send()
    t.s.advance(2000)
    const { nodes, edges } = g0('')
    t.s.setGraph({ nodes: nodes.filter((n) => n.id !== 'T').map((n) => (n.id === 'S' ? { ...n, config: { ...n.config, capacity: 1, behavior: 'on request:\n  call T /x or continue\n  reply 201' } } : n)), edges: [edges[0]] })
    t.s.advance(200)
    expect(t.repliesFrom('S').map((e) => e.msg.code)).toEqual([201])
    expect(t.s.nodeStats('S').inFlight).toBe(0)
  })
})
