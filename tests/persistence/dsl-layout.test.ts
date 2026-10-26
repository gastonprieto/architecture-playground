import { describe, expect, it } from 'vitest'
import { parseGraphDsl } from '../../src/persistence/dsl/parse'

function positions(text: string): Record<string, [number, number]> {
  const result = parseGraphDsl(text)
  if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`)
  return Object.fromEntries(result.graph.nodes.map((n) => [n.id, [n.position.x, n.position.y]]))
}

describe('auto-layout', () => {
  it('lays a chain out left to right', () => {
    expect(positions('service A, B, C\nA --> B --> C')).toEqual({ a: [0, 0], b: [250, 0], c: [500, 0] })
  })

  it('stacks a fan-out in declaration order', () => {
    const p = positions('service A, B, C\nA --> B, C')
    expect(p.b).toEqual([250, 0])
    expect(p.c).toEqual([250, 120])
  })

  it('puts a node on its longest path (diamond)', () => {
    const p = positions('service A, B, D\nA --> B --> D\nA --> D')
    expect(p.d[0]).toBe(500)
  })

  it('breaks cycles with the back edges of a DFS', () => {
    const p = positions('service A, B\nA --> B --> A')
    expect(p.a[0]).toBe(0)
    expect(p.b[0]).toBe(250)
  })

  it('orders rows by the mean row of the predecessors', () => {
    const p = positions('service A\nservice B\nservice X\nservice Y\nB --> X\nA --> Y')
    expect(p.y[1]).toBe(0)
    expect(p.x[1]).toBe(120)
  })

  it('keeps placed nodes and gives the others the first free row of their column', () => {
    const p = positions('service A\nservice B at 1,0\nservice C\nA --> B, C')
    expect(p.b).toEqual([250, 0])
    expect(p.c).toEqual([250, 120])
  })

  it('puts isolated nodes in column 0 below everything else', () => {
    const p = positions('service A, B, C\nA --> B')
    expect(p.c).toEqual([0, 120])
  })

  it('leaves a fully placed graph untouched', () => {
    const p = positions('service A at 2,3\nservice B at 0.5,1.25\nA --> B')
    expect(p).toEqual({ a: [500, 360], b: [125, 150] })
  })
})
