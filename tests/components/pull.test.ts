import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { Simulation, type SimEvents } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const sim = (g: Graph) => new Simulation(g, { seed: 7, registry: defaultRegistry })

/** Poll hops (pull probes) sent by `from`, collected live. */
function pollsFrom(s: Simulation, from: string): Message[] {
  const out: Message[] = []
  s.on('message:sent', (p: SimEvents['message:sent']) => {
    if (p.from === from && p.msg.kind === 'poll') out.push(p.msg)
  })
  return out
}

interface QueueState {
  items: Message[]
}

describe('pull model', () => {
  it('an idle worker polls its queue (the pull request travels worker → queue)', () => {
    const g: Graph = { nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue'), node('W', 'worker')], edges: [edge('C', 'Q'), edge('Q', 'W')] }
    const s = sim(g)
    const polls = pollsFrom(s, 'W')
    s.advance(3000)
    // With the default 1 s interval it polls a few times over 3 s (no work, so it keeps asking).
    expect(polls.length).toBeGreaterThanOrEqual(2)
  })

  it('a longer pollInterval means fewer polls over the same idle window', () => {
    const fast = sim({ nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue'), node('W', 'worker', { pollInterval: 200 })], edges: [edge('C', 'Q'), edge('Q', 'W')] })
    const slow = sim({ nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue'), node('W', 'worker', { pollInterval: 2000 })], edges: [edge('C', 'Q'), edge('Q', 'W')] })
    const fastPolls = pollsFrom(fast, 'W')
    const slowPolls = pollsFrom(slow, 'W')
    fast.advance(4000)
    slow.advance(4000)
    expect(fastPolls.length).toBeGreaterThan(slowPolls.length)
  })

  it('the queue holds the message until a worker pulls it, then hands it over', () => {
    const g: Graph = { nodes: [node('C', 'client', { rate: 0 }), node('Q', 'queue'), node('W', 'worker', { up: false })], edges: [edge('C', 'Q'), edge('Q', 'W')] }
    const s = sim(g)
    s.runAction('C', 'send1')
    s.advance(3000)
    // The worker is down, so it never pulls: the message just waits in the queue (no push).
    expect(s.nodeState<QueueState>('Q').items).toHaveLength(1)
    // Bring it up: it pulls and the queue drains.
    s.setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === 'W' ? { ...n, config: { up: true } } : n)) })
    s.advance(5000)
    expect(s.nodeState<QueueState>('Q').items).toHaveLength(0)
    expect(s.nodeStats('W').ok).toBe(1)
  })
})
