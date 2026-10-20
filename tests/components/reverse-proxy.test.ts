import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { EdgeRule, Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string, rule?: EdgeRule): GraphEdge => ({ id: `${source}-${target}`, source, target, rule })
const prefix = (value: string): EdgeRule => ({ kind: 'pathPrefix', value })
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

/** C → P → services, each service edge with an optional rule. */
function proxyGraph(
  proxyConfig: Record<string, unknown>,
  routes: [string, EdgeRule | undefined][],
  clientConfig: Record<string, unknown> = {},
): Graph {
  return {
    nodes: [
      node('C', 'client', { rate: 0, ...clientConfig }),
      node('P', 'reverse-proxy', proxyConfig),
      ...routes.map(([id]) => node(id, 'service')),
    ],
    edges: [edge('C', 'P'), ...routes.map(([id, rule]) => edge('P', id, rule))],
  }
}

const mixOf = (value: string) => ({ mix: [{ value, weight: 1 }] })

describe('reverse proxy', () => {
  it('has catalog metadata and config', () => {
    const d = defaultRegistry.get('reverse-proxy')!
    expect([d.label, d.icon, d.color]).toEqual(['Reverse Proxy', '🚪', 'req'])
    expect(d.config.authFailRate).toMatchObject({ type: 'number', label: 'Rechazo auth', default: 0, min: 0, max: 1 })
    expect(d.config.rateLimit).toMatchObject({ type: 'number', label: 'Rate limit', default: 0, min: 0, max: 100, unit: 'req/s' })
    expect(d.config.cacheHitRate).toMatchObject({ type: 'number', label: 'Cache hit', default: 0, min: 0, max: 1 })
  })

  it('routes to the longest matching prefix', () => {
    const s = sim(proxyGraph({}, [['S1', prefix('/ordenes')], ['S2', prefix('/ordenes/envios')]], mixOf('/ordenes/envios')))
    const sent = sentFrom(s, 'P')
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(sent.map((e) => e.to)).toEqual(['S2'])
    expect(res.map((r) => r.code)).toEqual([200])
  })

  it('an edge without a rule catches unmatched paths; specific rules still win', () => {
    const routes: [string, EdgeRule | undefined][] = [['S1', prefix('/ordenes')], ['S2', undefined]]
    const s = sim(proxyGraph({}, routes, { burstSize: 2, mix: [{ value: '/otra', weight: 1 }] }))
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(sent.map((e) => e.to)).toEqual(['S2', 'S2'])

    const s2 = sim(proxyGraph({}, routes, mixOf('/ordenes/1')))
    const sent2 = sentFrom(s2, 'P')
    s2.runAction('C', 'send1')
    s2.advance(5000)
    expect(sent2.map((e) => e.to)).toEqual(['S1'])
  })

  it('no match → 404 reply (not a drop)', () => {
    const s = sim(proxyGraph({}, [['S1', prefix('/ordenes')]], mixOf('/otra')))
    const res = clientResponses(s, 'C')
    const drops: unknown[] = []
    s.on('message:dropped', (p) => drops.push(p))
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => [r.status, r.code])).toEqual([['error', 404]])
    expect(drops).toEqual([])
  })

  it('authFailRate 1 → every reply is 401 and nothing is forwarded', () => {
    const s = sim(proxyGraph({ authFailRate: 1 }, [['S1', undefined]], { burstSize: 5 }))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(res.map((r) => r.code)).toEqual([401, 401, 401, 401, 401])
    expect(sent).toHaveLength(0)
  })

  it('rateLimit 1 with 5 requests in 1s → 4 replies are 429', () => {
    const s = sim(proxyGraph({ rateLimit: 1 }, [['S1', undefined]], { burstSize: 5 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(res).toHaveLength(5)
    expect(res.filter((r) => r.code === 429)).toHaveLength(4)
    expect(res.filter((r) => r.code === 200)).toHaveLength(1)
  })

  it('rate limit window slides: rejected requests do not count and old ones expire', () => {
    const s = sim(proxyGraph({ rateLimit: 1 }, [['S1', undefined]], { burstSize: 1 }))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'burst')
    s.advance(1100)
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(res.map((r) => r.code)).toEqual([200, 200])
  })

  it('cacheHitRate 1 → no request reaches a service, replies 200', () => {
    const s = sim(proxyGraph({ cacheHitRate: 1 }, [['S1', undefined]], { burstSize: 5 }))
    const res = clientResponses(s, 'C')
    const sent = sentFrom(s, 'P')
    const labels: string[] = []
    s.on('node:label', (p) => labels.push(`${p.nodeId}:${p.text}:${p.tone}`))
    s.runAction('C', 'burst')
    s.advance(5000)
    expect(sent).toHaveLength(0)
    expect(res.map((r) => r.code)).toEqual([200, 200, 200, 200, 200])
    expect(s.nodeStats('S1').ok).toBe(0)
    expect(labels).toEqual(Array(5).fill('P:HIT:redis'))
  })
})
