import { describe, expect, it } from 'vitest'
import type { Graph, GraphNode } from '../../src/engine/types'
import { nextClientIp } from '../../src/ui/clientIp'

const n = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })
const g = (...nodes: GraphNode[]): Graph => ({ nodes, edges: [] })

describe('nextClientIp', () => {
  it('starts at 10.0.0.1 on an empty graph', () => {
    expect(nextClientIp(g())).toBe('10.0.0.1')
  })

  it('takes the smallest free N, filling gaps', () => {
    expect(nextClientIp(g(n('a', 'client', { ip: '10.0.0.1' }), n('b', 'client', { ip: '10.0.0.2' })))).toBe('10.0.0.3')
    expect(nextClientIp(g(n('a', 'client', { ip: '10.0.0.1' }), n('b', 'client', { ip: '10.0.0.3' })))).toBe('10.0.0.2')
    expect(nextClientIp(g(n('a', 'client', { ip: '10.0.0.2' })))).toBe('10.0.0.1')
  })

  it('only counts clients, and ignores blank or foreign IPs', () => {
    expect(
      nextClientIp(
        g(
          n('s', 'service', { ip: '10.0.0.1' }),
          n('a', 'client', { ip: '' }),
          n('b', 'client', { ip: '192.168.0.1' }),
          n('c', 'client', {}),
          n('d', 'client', { ip: ' 10.0.0.1 ' }),
        ),
      ),
    ).toBe('10.0.0.2')
  })
})
