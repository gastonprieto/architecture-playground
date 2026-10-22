import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { ClientState } from '../../src/components/client'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const withHc = (g: Graph): Graph => ({ ...g, nodes: g.nodes.map((n) => (n.id === 'LB' ? { ...n, config: { ...n.config, healthChecks: true } } : n)) })
const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

function sentFrom(s: Simulation, from: string): { msg: Message; to: string }[] {
  const out: { msg: Message; to: string }[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from && p.msg.kind === 'request') out.push({ msg: p.msg, to: p.to })
  })
  return out
}

function clientResponses(s: Simulation, at: string): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === 'response') out.push(p.msg)
  })
  return out
}

/** C → LB → D1..Dn. */
function lbGraph(lbConfig: Record<string, unknown>, dbConfigs: Record<string, unknown>[], clientConfig = {}): Graph {
  const dbs = dbConfigs.map((c, i) => node(`D${i + 1}`, 'database', c))
  return {
    nodes: [node('C', 'client', { rate: 0, ...clientConfig }), node('LB', 'load-balancer', lbConfig), ...dbs],
    edges: [edge('C', 'LB'), ...dbs.map((d) => edge('LB', d.id))],
  }
}

describe('load balancer', () => {
  it('has catalog metadata and config', () => {
    const d = defaultRegistry.get('load-balancer')!
    expect([d.label, d.icon, d.color]).toEqual(['Load Balancer', '⚖️', 'hc'])
    expect(d.config.algorithm).toMatchObject({
      type: 'select',
      label: 'Algoritmo',
      options: [
        { value: 'round-robin', label: 'Round Robin' },
        { value: 'least-connections', label: 'Least Connections' },
        { value: 'random', label: 'Random' },
        { value: 'ip-hash', label: 'IP Hash' },
        { value: 'weighted', label: 'Weighted' },
      ],
    })
    expect(d.config.healthChecks).toMatchObject({ type: 'boolean', label: 'Health checks', default: false })
  })

  it('round-robin cycles 1,2,3,1,2,3', () => {
    const s = sim(lbGraph({ algorithm: 'round-robin' }, [{}, {}, {}], { burstSize: 6 }))
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(sent.map((e) => e.to)).toEqual(['D1', 'D2', 'D3', 'D1', 'D2', 'D3'])
  })

  it('least-connections prefers the target with fewer in flight', () => {
    const s = sim(
      lbGraph({ algorithm: 'least-connections' }, [{ processingTime: 5000, capacity: 50 }, { processingTime: 50, capacity: 50 }], {
        burstSize: 10,
      }),
    )
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'burst')
    // D2 has answered everything by now; D1 still holds its half in flight.
    s.advance(3000)
    expect(sent.filter((e) => e.to === 'D1')).toHaveLength(5)
    s.runAction('C', 'burst')
    s.advance(1500)
    const second = sent.slice(10)
    expect(second.length).toBeGreaterThanOrEqual(5)
    expect(second.slice(0, 5).every((e) => e.to === 'D2')).toBe(true)
  })

  it('ip-hash sends the same clientId to the same target', () => {
    const g = lbGraph({ algorithm: 'ip-hash' }, [{}, {}, {}], { burstSize: 10 })
    g.nodes.push(node('C2', 'client', { rate: 0, burstSize: 10 }))
    g.edges.push(edge('C2', 'LB'))
    const s = sim(g)
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'burst')
    s.runAction('C2', 'burst')
    s.advance(10_000)
    for (const id of ['C', 'C2']) {
      const targets = new Set(sent.filter((e) => e.msg.meta.clientId === id).map((e) => e.to))
      expect(targets.size).toBe(1)
    }
    expect(sent).toHaveLength(20)
  })

  it('ip-hash hashes the client IP: same IP → same target, even from different clients', () => {
    const g = lbGraph({ algorithm: 'ip-hash' }, [{}, {}, {}], { burstSize: 5, ip: '10.0.0.7' })
    g.nodes.push(node('C2', 'client', { rate: 0, burstSize: 5, ip: '10.0.0.7' }))
    g.edges.push(edge('C2', 'LB'))
    const s = sim(g)
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'burst')
    s.runAction('C2', 'burst')
    s.advance(10_000)
    expect(sent).toHaveLength(10)
    expect(new Set(sent.map((e) => e.to)).size).toBe(1)
  })

  it('ip-hash: 10.0.0.1 and 10.0.0.2 land on different targets (D3 and D1 of three)', () => {
    const g = lbGraph({ algorithm: 'ip-hash' }, [{}, {}, {}], { ip: '10.0.0.1' })
    g.nodes.push(node('C2', 'client', { rate: 0, ip: '10.0.0.2' }))
    g.edges.push(edge('C2', 'LB'))
    const s = sim(g)
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'send1')
    s.runAction('C2', 'send1')
    s.advance(5000)
    const to = (ip: string) => sent.find((e) => e.msg.meta.clientIp === ip)?.to
    expect(to('10.0.0.1')).toBe('D3')
    expect(to('10.0.0.2')).toBe('D1')
  })

  it('ip-hash with an empty IP falls back to the clientId', () => {
    const route = (clientConfig: Record<string, unknown>) => {
      const s = sim(lbGraph({ algorithm: 'ip-hash' }, [{}, {}, {}], clientConfig))
      const sent = sentFrom(s, 'LB')
      s.runAction('C', 'send1')
      s.advance(5000)
      return sent.map((e) => e.to)
    }
    expect(route({ ip: '' })).toEqual(route({}))
    expect(route({ ip: '' })).toHaveLength(1)
  })

  it('no algorithm emits a mapping label over the node', () => {
    for (const algorithm of ['round-robin', 'least-connections', 'random', 'weighted', 'ip-hash']) {
      const s = sim(lbGraph({ algorithm }, [{}, {}], { ip: '10.0.0.1', burstSize: 4 }))
      const labels: string[] = []
      s.on('node:label', (p) => {
        if (p.nodeId === 'LB') labels.push(p.text)
      })
      s.runAction('C', 'burst')
      s.advance(5000)
      expect(labels).toEqual([])
    }
  })

  /** lbGraph with a weight on each LB → D edge (undefined = no weight). */
  const weighted = (weights: (number | undefined)[], clientConfig: Record<string, unknown> = {}, dbConfigs?: Record<string, unknown>[]) => {
    const g = lbGraph({ algorithm: 'weighted' }, dbConfigs ?? weights.map(() => ({ capacity: 50, queueMax: 500 })), { burstSize: 200, ...clientConfig })
    g.edges = g.edges.map((e) => {
      const i = Number(e.target.slice(1)) - 1
      return e.source === 'LB' && weights[i] !== undefined ? { ...e, weight: weights[i] } : e
    })
    return g
  }
  const shares = (g: Graph, bursts = 2) => {
    const s = sim(g)
    const sent = sentFrom(s, 'LB')
    for (let i = 0; i < bursts; i++) {
      s.runAction('C', 'burst')
      s.advance(2500)
    }
    const count: Record<string, number> = {}
    for (const e of sent) count[e.to] = (count[e.to] ?? 0) + 1
    return { total: sent.length, count, order: sent.map((e) => e.to) }
  }

  it('weighted: edge weights 3:1 give exactly 300/100 over 400 requests, interleaved (smooth WRR)', () => {
    const r = shares(weighted([3, 1]))
    expect(r.total).toBe(400)
    expect(r.count).toEqual({ D1: 300, D2: 100 })
    expect(r.order.slice(0, 4)).toEqual(['D1', 'D1', 'D2', 'D1'])
  })

  it('weighted: a weight-0 connection is never chosen', () => {
    const r = shares(weighted([2, 0, 1]))
    expect(r.count.D2).toBeUndefined()
    expect(r.count).toEqual({ D1: 267, D3: 133 })
  })

  it('weighted: all weights 0 falls back to an equal split', () => {
    const r = shares(weighted([0, 0], { burstSize: 100 }))
    expect(r.count).toEqual({ D1: 100, D2: 100 })
  })

  it('weighted: missing weights count as 1 (equal split), whatever the target capacity', () => {
    const r = shares(weighted([undefined, undefined], { burstSize: 100 }, [{ capacity: 3, queueMax: 500 }, { capacity: 1, queueMax: 500 }]))
    expect(r.count).toEqual({ D1: 100, D2: 100 })
  })

  it('weighted: when every healthy target has weight 0, it splits equally among them', () => {
    const r = shares(withHc(weighted([5, 0, 0], { burstSize: 100 }, [{ up: false }, { capacity: 50, queueMax: 500 }, { capacity: 50, queueMax: 500 }])))
    expect(r.count).toEqual({ D2: 100, D3: 100 })
  })

  it('weighted: health checks drop down targets before weighting', () => {
    const r = shares(withHc(weighted([5, 1, 1], { burstSize: 100 }, [{ up: false }, { capacity: 50, queueMax: 500 }, { capacity: 50, queueMax: 500 }])))
    expect(r.count).toEqual({ D2: 100, D3: 100 })
  })

  it('random spreads across targets', () => {
    const s = sim(lbGraph({ algorithm: 'random' }, [{}, {}], { burstSize: 100 }))
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'burst')
    s.advance(2500)
    const d1 = sent.filter((e) => e.to === 'D1').length
    expect(d1).toBeGreaterThan(25)
    expect(d1).toBeLessThan(75)
  })

  it('health checks off: a down target gets ~1/3 of requests, which fail with 503', () => {
    const s = sim(lbGraph({ algorithm: 'round-robin', healthChecks: false }, [{}, {}, { up: false }], { burstSize: 30 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(20_000)
    expect(res).toHaveLength(30)
    expect(res.filter((r) => r.code === 503)).toHaveLength(10)
  })

  it('health checks on: skips down targets, no errors', () => {
    const s = sim(lbGraph({ algorithm: 'round-robin', healthChecks: true }, [{}, {}, { up: false }], { burstSize: 30 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(20_000)
    expect(res).toHaveLength(30)
    expect(res.filter((r) => r.status === 'error')).toHaveLength(0)
  })

  it('all targets down with health checks on → 503', () => {
    const s = sim(lbGraph({ healthChecks: true }, [{ up: false }, { up: false }]))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([503])
  })

  it('in-flight bookkeeping is balanced after responses', () => {
    const s = sim(lbGraph({ algorithm: 'least-connections' }, [{}, {}, { up: false }], { burstSize: 10 }))
    s.runAction('C', 'burst')
    s.advance(20_000)
    const st = s.nodeState<{ inflight: Record<string, number>; pending: Record<string, string> }>('LB')
    expect(Object.values(st.inflight).every((n) => n === 0)).toBe(true)
    expect(st.pending).toEqual({})
  })
})

describe('load balancer sticky sessions (sessions spec §7)', () => {
  const MEMORY = 'on request:\n  session memory\n'
  /** C (n users) → LB → S1..Sk, each a service with `session memory`. */
  function lane(lb: Record<string, unknown>, users: number, servers = 3) {
    const ids = Array.from({ length: servers }, (_, i) => `S${i + 1}`)
    const g: Graph = {
      nodes: [
        node('C', 'client', { rate: 0, users }),
        node('LB', 'load-balancer', lb),
        ...ids.map((id) => node(id, 'service', { processingTime: 100, behavior: MEMORY })),
      ],
      edges: [edge('C', 'LB'), ...ids.map((id) => edge('LB', id))],
    }
    const s = sim(g)
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'LB')
    /** One request every 3 s, so each completes (2.5 s through the LB) before the next. */
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        s.runAction('C', 'send1')
        s.advance(3000)
      }
    }
    /** userIndex → the set of servers its requests went to (from `from` on). */
    const serversByUser = (from = 0) => {
      const m = new Map<number, Set<string>>()
      for (const e of sent.slice(from)) {
        const k = e.msg.meta.userIndex as number
        if (!m.has(k)) m.set(k, new Set())
        m.get(k)!.add(e.to)
      }
      return m
    }
    return { s, g, res, sent, run, serversByUser }
  }
  const lost = (res: Message[]) => res.filter((m) => m.meta.authError === 'session-lost')

  it('has a sticky toggle, off by default', () => {
    expect(defaultRegistry.get('load-balancer')!.config.sticky).toMatchObject({ type: 'boolean', default: false })
  })

  it('without sticky, 5 users over 3 servers churn (session-lost)', () => {
    const t = lane({}, 5)
    t.run(25)
    expect(lost(t.res).length).toBeGreaterThan(5)
  })

  it('with sticky, 5 users stick to the server that logged them in: 0 session-lost', () => {
    const t = lane({ sticky: true }, 5)
    t.run(25)
    expect(lost(t.res)).toEqual([])
    expect(t.res.filter((m) => m.meta.setSession)).toHaveLength(5)
    for (const servers of t.serversByUser(5).values()) expect(servers.size).toBe(1)
  })

  it('with sticky, 6 users stick to their server and have 0 session-lost', () => {
    const t = lane({ sticky: true }, 6)
    t.run(30)
    expect(lost(t.res)).toEqual([])
    expect(t.serversByUser(6).size).toBe(6)
    for (const servers of t.serversByUser(6).values()) expect(servers.size).toBe(1)
  })

  it('sticky wins over ip-hash and weighted when the cookie is known', () => {
    for (const algorithm of ['ip-hash', 'weighted', 'random', 'least-connections']) {
      const t = lane({ sticky: true, algorithm }, 5)
      t.run(25)
      expect(lost(t.res), algorithm).toEqual([])
    }
  })

  it('taking a server down (health checks on) moves its users: one 401 each, then they re-login and stick again', () => {
    const t = lane({ sticky: true, healthChecks: true }, 6)
    t.run(12)
    const before = t.serversByUser(6)
    const onS1 = [...before.entries()].filter(([, set]) => set.has('S1')).map(([k]) => k)
    expect(onS1.length).toBeGreaterThan(0)

    const from = t.sent.length
    const resFrom = t.res.length
    t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { ...n.config, up: false } } : n)) })
    t.run(30)

    const after = t.res.slice(resFrom)
    const lostUsers = lost(after).map((m) => m.meta.userIndex).sort()
    expect(lostUsers).toEqual([...onS1].sort())
    for (const k of onS1) {
      const mine = after.filter((m) => m.meta.userIndex === k)
      expect(mine[0].meta.authError).toBe('session-lost')
      expect(mine[1].meta.setSession).toMatch(/^sid:/)
    }
    const moved = t.serversByUser(from)
    for (const [k, set] of moved) {
      expect(set.has('S1'), `user ${k}`).toBe(false)
      // After the re-login, each moved user stays on one server.
      if (onS1.includes(k)) {
        const late = t.sent.slice(from).filter((e) => e.msg.meta.userIndex === k).slice(1)
        expect(new Set(late.map((e) => e.to)).size).toBe(1)
      }
    }
  })

  it('a map entry pointing at a removed server falls back to the algorithm without crashing (Review Focus 3)', () => {
    const t = lane({ sticky: true }, 6)
    t.run(12)
    const g2: Graph = { nodes: t.g.nodes.filter((n) => n.id !== 'S1'), edges: t.g.edges.filter((e) => e.target !== 'S1') }
    t.s.setGraph(g2)
    const from = t.sent.length
    const resFrom = t.res.length
    expect(() => t.run(24)).not.toThrow()
    expect(t.sent.slice(from).every((e) => e.to !== 'S1')).toBe(true)
    expect(t.res.length - resFrom).toBe(24)
    // Only the users that were on S1 lose their session, once each.
    expect(lost(t.res.slice(resFrom)).length).toBe(2)
  })

  it('a session-lost 401 drops the stale entry from the map', () => {
    const t = lane({ sticky: true, healthChecks: true }, 6)
    t.run(12)
    t.s.setGraph({ ...t.g, nodes: t.g.nodes.map((n) => (n.id === 'S1' ? { ...n, config: { ...n.config, up: false } } : n)) })
    t.run(30)
    const map = t.s.nodeState<{ sticky: Record<string, string> }>('LB').sticky
    const cookies = t.s.nodeState<ClientState>('C').cookies
    expect(Object.keys(map).sort()).toEqual([...cookies].sort())
  })

  it('without sticky the LB learns nothing', () => {
    const t = lane({}, 5)
    t.run(10)
    expect(t.s.nodeState<{ sticky: Record<string, string> }>('LB').sticky).toEqual({})
  })
})
