import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { HOP_MS, Simulation } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

function clientResponses(s: Simulation, at: string): Message[] {
  const out: Message[] = []
  s.on('message:arrived', (p) => {
    if (p.at === at && p.msg.kind === 'response') out.push(p.msg)
  })
  return out
}

const cacheGraph = (hitRate: number, withDb = true): Graph => ({
  nodes: [
    node('C', 'client', { rate: 0, burstSize: 10 }),
    node('K', 'cache', { hitRate }),
    ...(withDb ? [node('D', 'database')] : []),
  ],
  edges: [edge('C', 'K'), ...(withDb ? [edge('K', 'D')] : [])],
})

describe('cache', () => {
  it('has catalog metadata and config', () => {
    const d = defaultRegistry.get('cache')!
    expect([d.label, d.icon, d.color]).toEqual(['Cache', '⚡', 'redis'])
    expect(d.config.hitRate).toMatchObject({ type: 'number', label: 'Hit rate', default: 0.8, min: 0, max: 1 })
    expect(d.config.processingTime).toMatchObject({ type: 'number', default: 50 })
    expect(d.config.capacity).toBeUndefined()
    expect(d.config.queueMax).toBeUndefined()
  })

  it('hitRate 1 → the DB receives nothing; replies 200 with a HIT label', () => {
    const s = sim(cacheGraph(1))
    const res = clientResponses(s, 'C')
    const labels: string[] = []
    s.on('node:label', (p) => labels.push(`${p.text}:${p.tone}`))
    s.runAction('C', 'burst')
    s.advance(10_000)
    expect(res.map((r) => r.code)).toEqual(Array(10).fill(200))
    expect(s.nodeStats('D').ok).toBe(0)
    expect(labels).toEqual(Array(10).fill('HIT:redis'))
    expect(s.nodeState<{ stored: number }>('K').stored).toBe(0)
  })

  it('hit latency is 2 hops plus the 50 ms lookup', () => {
    const s = sim({ ...cacheGraph(1), nodes: [node('C', 'client', { rate: 0 }), node('K', 'cache', { hitRate: 1 }), node('D', 'database')] })
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(s.metrics().p50).toBe(2 * HOP_MS + 50)
  })

  it('hitRate 0 → the DB receives everything and state.stored counts them', () => {
    const s = sim(cacheGraph(0))
    const res = clientResponses(s, 'C')
    const labels: string[] = []
    s.on('node:label', (p) => labels.push(`${p.text}:${p.tone}`))
    s.runAction('C', 'burst')
    s.advance(20_000)
    expect(res.map((r) => r.code)).toEqual(Array(10).fill(200))
    expect(s.nodeStats('D').ok).toBe(10)
    expect(s.nodeState<{ stored: number }>('K').stored).toBe(10)
    expect(labels).toEqual(Array(10).fill('MISS:slow'))
  })

  it('a miss without an output gets 503', () => {
    const s = sim(cacheGraph(0, false))
    const res = clientResponses(s, 'C')
    s.runAction('C', 'send1')
    s.advance(5000)
    expect(res.map((r) => [r.status, r.code])).toEqual([['error', 503]])
  })
})
