import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components'
import { defaultConfig } from '../../src/engine/registry'
import type { Graph } from '../../src/engine/types'
import { parseDocument, parseGraphDsl, slugify, TYPE_KEYWORDS } from '../../src/persistence/dsl/parse'

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

const edgePairs = (g: Graph) => g.edges.map((e) => e.id)
const nodeById = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!
const ruleOf = (text: string) => graphOf(`client A\nservice B\n${text}`).edges[0]

describe('parseGraphDsl', () => {
  it('parses a minimal graph with default configs', () => {
    const g = graphOf('client Web\nservice API\nWeb --> API')
    expect(g.nodes).toEqual([
      { id: 'web', type: 'client', position: { x: 0, y: 0 }, config: { ...defaultConfig(defaultRegistry.get('client')!), name: 'Web' } },
      { id: 'api', type: 'service', position: { x: 250, y: 0 }, config: { ...defaultConfig(defaultRegistry.get('service')!), name: 'API' } },
    ])
    expect(g.edges).toEqual([{ id: 'web-api', source: 'web', target: 'api' }])
  })

  it('expands chains, fan-out and fan-in', () => {
    const decl = 'service A\nservice B\nservice C\nservice D\n'
    expect(edgePairs(graphOf(`${decl}A --> B --> C, D`))).toEqual(['a-b', 'b-c', 'b-d'])
    expect(edgePairs(graphOf(`${decl}A, B --> C`))).toEqual(['a-c', 'b-c'])
  })

  it('reads edge attributes in short and long form', () => {
    expect(ruleOf('A --> B [/api]')).toMatchObject({ rule: { kind: 'pathPrefix', value: '/api' } })
    expect(ruleOf('A --> B [OrdenCreada]')).toMatchObject({ rule: { kind: 'eventType', value: 'OrdenCreada' } })
    expect(ruleOf('A --> B [x3]')).toEqual({ id: 'a-b', source: 'a', target: 'b', weight: 3 })
    expect(ruleOf('A --> B [path api]')).toMatchObject({ rule: { kind: 'pathPrefix', value: 'api' } })
    expect(ruleOf('A --> B [event x3]')).toEqual({ id: 'a-b', source: 'a', target: 'b', rule: { kind: 'eventType', value: 'x3' } })
    expect(ruleOf('A --> B [weight 2]')).toMatchObject({ weight: 2 })
    expect(ruleOf('A --> B [/api x3]')).toEqual({
      id: 'a-b',
      source: 'a',
      target: 'b',
      rule: { kind: 'pathPrefix', value: '/api' },
      weight: 3,
    })
    expect(errorsOf('client A\nservice B\nA --> B [/a /b]')).toEqual([{ line: 3, code: 'duplicate-rule' }])
    expect(errorsOf('client A\nservice B\nA --> B [weight]')).toEqual([{ line: 3, code: 'bad-attribute', params: { word: 'weight' } }])
  })

  it('applies a config block to every name of the declaration', () => {
    const g = graphOf('service Stock, Pagos\n  capacity: 4')
    expect(g.nodes.map((n) => [n.id, n.config.capacity])).toEqual([
      ['stock', 4],
      ['pagos', 4],
    ])
    expect(nodeById(graphOf('client Web\n  mix: /a x3'), 'web').config.mix).toEqual([{ value: '/a', weight: 3 }])
  })

  it('resolves aliases before names and reports ambiguous names', () => {
    const decl = 'service Órdenes\nservice Órdenes as ord2\nclient W\n'
    const g = graphOf(`${decl}W --> ord2`)
    expect(g.nodes.map((n) => n.id)).toEqual(['ordenes', 'ord2', 'w'])
    expect(g.edges).toEqual([{ id: 'w-ord2', source: 'w', target: 'ord2' }])
    expect(errorsOf(`${decl}W --> Órdenes`)).toEqual([{ line: 4, code: 'ambiguous-ref', params: { name: 'Órdenes' } }])
  })

  it('places nodes with `at` and keeps `at` inside names', () => {
    const doc = parseDocument('service A at 2,1.5\ndatabase Data at rest')
    expect(doc.errors).toEqual([])
    expect(nodeById(doc.graph, 'a').position).toEqual({ x: 500, y: 180 })
    expect(doc.placed).toEqual(new Set(['a']))
    expect(nodeById(doc.graph, 'data-at-rest').config.name).toBe('Data at rest')
  })

  it('keeps a behavior block verbatim, dedented', () => {
    const text = [
      'service Orders',
      '  behavior:',
      '    on request /orders:',
      '      # reserve first',
      '',
      '      call Stock /reservas',
      '        retry 2',
      '    \tweird',
      'service Next',
    ].join('\n')
    const g = graphOf(text)
    expect(g.nodes.map((n) => n.id)).toEqual(['orders', 'next'])
    expect(nodeById(g, 'orders').config.behavior).toBe(
      'on request /orders:\n  # reserve first\n\n  call Stock /reservas\n    retry 2\n\tweird\n',
    )
  })

  it('strips comments but keeps # inside values and quotes', () => {
    const g = graphOf('# header\nclient W   # trailing\n  color: #d97706\nservice "A # B"')
    expect(g.nodes.map((n) => n.config.name)).toEqual(['W', 'A # B'])
    expect(nodeById(g, 'w').config.color).toBe('#d97706')
  })

  it('treats # as a value when it is glued to text', () => {
    const g = graphOf('subscriber S\n  emits: #tag\n  # a comment line\nclient W #not-a-comment')
    expect(nodeById(g, 's').config.emits).toBe('#tag')
    expect(g.nodes.map((n) => n.config.name)).toEqual(['S', 'W #not-a-comment'])
  })

  it('reports select options, a value under a block, and attributes on the first group', () => {
    expect(errorsOf('lb L\n  algorithm: nope')).toEqual([
      { line: 2, code: 'bad-value', params: { key: 'algorithm', value: 'nope', options: expect.any(String) } },
    ])
    expect(errorsOf('service S\n  capacity:\n    3')).toEqual([{ line: 2, code: 'bad-value', params: { key: 'capacity', value: '' } }])
    expect(errorsOf('service A\nservice B\nA [/x] --> B')).toEqual([{ line: 3, code: 'bad-attribute', params: { word: '[/x]' } }])
  })

  it('accepts CRLF, a BOM and trailing spaces', () => {
    const plain = graphOf('client Web\nservice API\nWeb --> API')
    expect(graphOf('﻿client Web  \r\nservice API \r\nWeb --> API   \r\n')).toEqual(plain)
  })

  it('accepts the v1 header only', () => {
    expect(graphOf('@architecture v1\nclient W').nodes).toHaveLength(1)
    expect(errorsOf('@architecture v2\nclient W')).toEqual([{ line: 1, code: 'unknown-version', params: { version: 'v2' } }])
  })

  it('never returns a graph when there are errors', () => {
    expect(parseGraphDsl('servise X')).toEqual({ ok: false, errors: expect.any(Array) })
  })
})

describe('parseGraphDsl errors', () => {
  it('unknown-type', () => {
    expect(errorsOf('servise X')).toEqual([{ line: 1, code: 'unknown-type', params: { word: 'servise', suggestion: 'service' } }])
  })

  it('unknown-key', () => {
    expect(errorsOf('service S\n  capacty: 3')).toEqual([
      { line: 2, code: 'unknown-key', params: { key: 'capacty', type: 'service', suggestion: 'capacity' } },
    ])
  })

  it('out-of-range', () => {
    expect(errorsOf('service S\n  capacity: 0')).toEqual([{ line: 2, code: 'out-of-range', params: { key: 'capacity', min: 1, max: 50 } }])
  })

  it('bad-value', () => {
    expect(errorsOf('service S\n  capacity: fast')).toEqual([{ line: 2, code: 'bad-value', params: { key: 'capacity', value: 'fast' } }])
    expect(errorsOf('service S\n  behavior: on request')).toEqual([
      { line: 2, code: 'bad-value', params: { key: 'behavior', value: 'on request' } },
    ])
  })

  it('missing-colon', () => {
    expect(errorsOf('service S\n  capacity')).toEqual([{ line: 2, code: 'missing-colon' }])
  })

  it('duplicate-key', () => {
    expect(errorsOf('service S\n  capacity: 3\n  capacity: 4')).toEqual([{ line: 3, code: 'duplicate-key', params: { key: 'capacity' } }])
  })

  it('unknown-ref', () => {
    expect(errorsOf('client W\nservice Stock\nW --> Stok')).toEqual([
      { line: 3, code: 'unknown-ref', params: { name: 'Stok', suggestion: 'Stock' } },
    ])
  })

  it('duplicate-edge', () => {
    expect(errorsOf('client W\nservice S\nW --> S\nW --> S')).toEqual([
      { line: 4, code: 'duplicate-edge', params: { source: 'W', target: 'S' } },
    ])
  })

  it('gives distinct ids to distinct pairs whose edge ids collide', () => {
    const g = graphOf('service A\nservice "B C"\nservice "A B"\nservice C\nA --> B C\nA B --> C')
    expect(g.edges.map((e) => e.id)).toEqual(['a-b-c', 'a-b-c-2'])
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([['a', 'b-c'], ['a-b', 'c']])
  })

  it('reports bad-attribute with the token as written', () => {
    expect(errorsOf('client A\nservice B\nA --> B [x3a]')).toEqual([{ line: 3, code: 'bad-attribute', params: { word: 'x3a' } }])
    expect(errorsOf('client A\nservice B\nA --> B [x2 x3]')).toEqual([{ line: 3, code: 'bad-attribute', params: { word: 'x3' } }])
    expect(errorsOf('client A\nservice B\nA --> B [weight 3a]')).toEqual([{ line: 3, code: 'bad-attribute', params: { word: '3a' } }])
  })

  it('multi-alias', () => {
    expect(errorsOf('service A, B as x')).toEqual([{ line: 1, code: 'multi-alias' }])
  })

  it('missing-name', () => {
    expect(errorsOf('service ')).toEqual([{ line: 1, code: 'missing-name' }])
  })

  it('tab', () => {
    expect(errorsOf('service S\n\tcapacity: 3')).toEqual([{ line: 2, code: 'tab' }])
  })

  it('bad-indent', () => {
    expect(errorsOf('    capacity: 3')).toEqual([{ line: 1, code: 'bad-indent' }])
    expect(errorsOf('service S\n    capacity: 3')).toEqual([{ line: 2, code: 'bad-indent' }])
  })

  it('duplicate-alias', () => {
    expect(errorsOf('service A as x\nservice B as x')).toEqual([{ line: 2, code: 'duplicate-alias', params: { alias: 'x' } }])
  })

  it('collects several errors sorted by line', () => {
    expect(errorsOf('client W\nW --> Zzzzz\nservise Y\nservice S\n  capacity: 0')).toEqual([
      { line: 2, code: 'unknown-ref', params: { name: 'Zzzzz' } },
      { line: 3, code: 'unknown-type', params: { word: 'servise', suggestion: 'service' } },
      { line: 5, code: 'out-of-range', params: { key: 'capacity', min: 1, max: 50 } },
    ])
  })
})

describe('helpers', () => {
  it('slugify', () => {
    expect(slugify('DB Stock')).toBe('db-stock')
    expect(slugify('  Órdenes / Pagos! ')).toBe('ordenes-pagos')
    expect(slugify('***')).toBe('node')
  })

  it('TYPE_KEYWORDS maps aliases to registry types', () => {
    expect(TYPE_KEYWORDS).toMatchObject({ db: 'database', lb: 'load-balancer', proxy: 'reverse-proxy', service: 'service' })
    for (const type of Object.values(TYPE_KEYWORDS)) expect(defaultRegistry.get(type)).toBeDefined()
  })
})
