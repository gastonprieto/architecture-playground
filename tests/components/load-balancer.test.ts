import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
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

  it('ip-hash labels each forwarded request "<ip> → <target name>"', () => {
    const g = lbGraph({ algorithm: 'ip-hash' }, [{ name: 'Srv A' }, { name: 'Srv B' }, { name: 'Srv C' }], { ip: '10.0.0.1' })
    const s = sim(g)
    const labels: { text: string; tone: string }[] = []
    s.on('node:label', (p) => {
      if (p.nodeId === 'LB') labels.push({ text: p.text, tone: p.tone })
    })
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(labels).toEqual([{ text: '10.0.0.1 → Srv C', tone: 'hc' }])
  })

  it('ip-hash label uses the client name when the client has no IP', () => {
    const g = lbGraph({ algorithm: 'ip-hash' }, [{ name: 'Srv A' }], { ip: '', name: 'Navegador' })
    const s = sim(g)
    const labels: string[] = []
    s.on('node:label', (p) => {
      if (p.nodeId === 'LB') labels.push(p.text)
    })
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(labels).toEqual(['Navegador → Srv A'])
  })

  it('other algorithms emit no mapping label', () => {
    for (const algorithm of ['round-robin', 'least-connections', 'random', 'weighted']) {
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

  it('weighted by capacity 3,1 gives about 75/25 over 400 requests', () => {
    const s = sim(
      lbGraph({ algorithm: 'weighted' }, [{ capacity: 3, queueMax: 500 }, { capacity: 1, queueMax: 500 }], { burstSize: 200 }),
    )
    const sent = sentFrom(s, 'LB')
    s.runAction('C', 'burst')
    s.advance(2500)
    s.runAction('C', 'burst')
    s.advance(2500)
    expect(sent).toHaveLength(400)
    const share = sent.filter((e) => e.to === 'D1').length / 400
    expect(share).toBeGreaterThan(0.67)
    expect(share).toBeLessThan(0.83)
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
