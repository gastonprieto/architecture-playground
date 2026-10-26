import { describe, expect, it } from 'vitest'
import type { Graph } from '../../src/engine/types'
import { parseGraphDsl, printGraphDsl } from '../../src/persistence/dsl'
import { prepareGraph } from '../../src/ui/graphEntry'

function graphOf(text: string): Graph {
  const result = parseGraphDsl(text)
  if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`)
  return result.graph
}

function errorsOf(text: string) {
  const result = parseGraphDsl(text)
  if (result.ok) throw new Error('expected errors')
  return result.errors
}

const roundTrip = (g: Graph) => graphOf(printGraphDsl(g))

describe('hand-written clients', () => {
  it('leave color and ip out unless the text sets them', () => {
    const g = graphOf('client A\nclient B\n  color: #d97706\n  ip: 1.2.3.4')
    expect(g.nodes[0].config).not.toHaveProperty('color')
    expect(g.nodes[0].config).not.toHaveProperty('ip')
    expect(g.nodes[1].config).toMatchObject({ color: '#d97706', ip: '1.2.3.4' })
  })

  it('get distinct colors and IPs from prepareGraph', () => {
    const [a, b] = prepareGraph(graphOf('client A\nclient B')).nodes
    expect(a.config.color).not.toBe(b.config.color)
    expect(a.config.ip).not.toBe('')
    expect(a.config.ip).not.toBe(b.config.ip)
  })

  it('print their color, so a default-colored client keeps it after re-import', () => {
    const g: Graph = {
      nodes: [{ id: 'a', type: 'client', position: { x: 0, y: 0 }, config: { name: 'A', color: '#3b82f6', ip: '' } }],
      edges: [],
    }
    const text = printGraphDsl(g)
    expect(text).toContain('color: #3b82f6')
    expect(text).not.toContain('ip:')
    expect(roundTrip(g).nodes[0].config.color).toBe('#3b82f6')
  })
})

describe('behavior dedent', () => {
  it('uses the smallest indentation of the block', () => {
    const two = graphOf('service A\n  behavior:\n    on request /a:\n      reply 200\n').nodes[0].config.behavior
    const six = graphOf('service A\n  behavior:\n        on request /a:\n          reply 200\n').nodes[0].config.behavior
    expect(two).toBe('on request /a:\n  reply 200\n')
    expect(six).toBe(two)
  })
})

describe('empty strings', () => {
  it('round-trip in rules, names, list items and mix values', () => {
    const g = graphOf('service A\nservice B\ncache C\nclient K\nA --> B [/x]\nA --> C [e]')
    g.edges[0].rule = { kind: 'pathPrefix', value: '' }
    g.edges[1].rule = { kind: 'eventType', value: '' }
    g.nodes[0].config.name = ''
    g.nodes[3].config.mix = [
      { value: '', weight: 2 },
      { value: '/a', weight: 1 },
    ]
    const proxy = graphOf('reverse-proxy P').nodes[0]
    proxy.config.cacheablePaths = ['/static', '']
    g.nodes.push({ ...proxy, id: 'p' })
    const text = printGraphDsl(g)
    expect(text).toContain('[path ""]')
    expect(text).toContain('[event ""]')
    const back = graphOf(text)
    expect(back.edges.map((e) => e.rule)).toEqual([
      { kind: 'pathPrefix', value: '' },
      { kind: 'eventType', value: '' },
    ])
    expect(back.nodes[0].config.name).toBe('')
    expect(back.nodes[3].config.mix).toEqual(g.nodes[3].config.mix)
    expect(back.nodes[4].config.cacheablePaths).toEqual(['/static', ''])
    const lone = { ...proxy, id: 'q' }
    lone.config = { ...proxy.config, cacheablePaths: [''] }
    expect(roundTrip({ nodes: [lone], edges: [] }).nodes[0].config.cacheablePaths).toEqual([''])
  })

  it('accept a quoted empty name but not a bare missing one', () => {
    expect(graphOf('service ""\nservice B\n"" --> B').edges).toHaveLength(1)
    expect(errorsOf('service ').map((e) => e.code)).toEqual(['missing-name'])
  })
})

describe('as / at', () => {
  it('go in either order', () => {
    for (const text of ['service A as a at 1,2', 'service A at 1,2 as a']) {
      const node = graphOf(text).nodes[0]
      expect(node).toMatchObject({ id: 'a', position: { x: 250, y: 240 } })
      expect(node.config.name).toBe('A')
    }
  })

  it('still reject several names', () => {
    expect(errorsOf('service A, B at 1,2 as x')).toEqual([{ line: 1, code: 'multi-alias' }])
  })
})

describe('failed declarations', () => {
  it('do not cascade unknown-ref onto their edges', () => {
    expect(errorsOf('servise A\nservice B\nA --> B').map((e) => e.code)).toEqual(['unknown-type'])
    expect(errorsOf('service A, B as x\nservice C\nB --> C\nx --> C').map((e) => e.code)).toEqual(['multi-alias'])
  })

  it('report an unquoted bracket in the name as bad-attribute', () => {
    expect(errorsOf('service A [x]')).toEqual([{ line: 1, code: 'bad-attribute', params: { word: '[x]' } }])
    expect(graphOf('service "A [x]"').nodes[0].config.name).toBe('A [x]')
  })
})
