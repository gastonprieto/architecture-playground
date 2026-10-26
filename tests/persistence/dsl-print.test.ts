import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components'
import { defaultConfig } from '../../src/engine/registry'
import type { Graph, GraphNode } from '../../src/engine/types'
import { parseGraphDsl, printGraphDsl } from '../../src/persistence/dsl'
import { getPresets } from '../../src/presets'

function graphOf(text: string): Graph {
  const result = parseGraphDsl(text)
  if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`)
  return result.graph
}

const roundTrip = (g: Graph) => graphOf(printGraphDsl(g))

/** The config as the engine sees it: defaults filled in, behavior text normalized to end in one `\n`. */
function effectiveConfig(n: GraphNode): Record<string, unknown> {
  const def = defaultRegistry.get(n.type)!
  const config: Record<string, unknown> = { ...defaultConfig(def), ...n.config }
  for (const [key, field] of Object.entries(def.config)) {
    if (field.type !== 'behavior') continue
    const text = String(config[key] ?? '').trimEnd()
    config[key] = text === '' ? '' : text + '\n'
  }
  return config
}

function expectSameGraph(g2: Graph, g: Graph) {
  expect(g2.nodes.length).toBe(g.nodes.length)
  g.nodes.forEach((n, i) => {
    const n2 = g2.nodes[i]
    expect(n2.type).toBe(n.type)
    expect(effectiveConfig(n2)).toEqual(effectiveConfig(n))
    expect(Math.abs(n2.position.x - n.position.x)).toBeLessThanOrEqual(1.25)
    expect(Math.abs(n2.position.y - n.position.y)).toBeLessThanOrEqual(1.25)
  })
  const index = (graph: Graph) => new Map(graph.nodes.map((n, i) => [n.id, i]))
  const shape = (graph: Graph) => {
    const at = index(graph)
    return graph.edges.map((e) => ({ source: at.get(e.source), target: at.get(e.target), rule: e.rule, weight: e.weight }))
  }
  expect(shape(g2)).toEqual(shape(g))
}

const SPEC_EXAMPLE = `# Orquestación de una compra

client Web
  rate: 2
  mix: /ordenes x3, /productos

service Órdenes
  capacity: 16
  queueMax: 20
  behavior:
    on request /ordenes:
      call Stock /reservas
      call Pagos /cobros or reply 402
      reply 201

service Stock, Pagos
  capacity: 4
database DB Stock, DB Pagos

Web --> Órdenes --> Stock, Pagos
Stock --> DB Stock
Pagos --> DB Pagos
`

describe('printGraphDsl', () => {
  it('prints the spec example', () => {
    expect(printGraphDsl(graphOf(SPEC_EXAMPLE))).toBe(`@architecture v1

client Web at 0,0
  rate: 2
  mix: /ordenes x3, /productos

service Órdenes at 1,0
  capacity: 16
  queueMax: 20
  behavior:
    on request /ordenes:
      call Stock /reservas
      call Pagos /cobros or reply 402
      reply 201

service Stock at 2,0
  capacity: 4

service Pagos at 2,1
  capacity: 4

database DB Stock at 3,0
database DB Pagos at 3,1

Web --> Órdenes
Órdenes --> Stock, Pagos
Stock --> DB Stock
Pagos --> DB Pagos
`)
  })

  it('omits defaults', () => {
    expect(printGraphDsl(graphOf('service A'))).toBe('@architecture v1\n\nservice A at 0,0\n')
  })

  it('prints fractional positions with up to two decimals', () => {
    const g = graphOf('service A at 0,0')
    g.nodes[0].position = { x: 312.5, y: 40.123 }
    expect(printGraphDsl(g)).toBe('@architecture v1\n\nservice A at 1.25,0.33\n')
  })

  it('edge attributes', () => {
    const g = graphOf('client A\nservice B, C, D, E, F, G, H, I, J')
    const rules = [
      { rule: { kind: 'pathPrefix' as const, value: '/api' }, weight: 3 },
      { rule: { kind: 'pathPrefix' as const, value: 'api' } },
      { rule: { kind: 'pathPrefix' as const, value: '/a b' } },
      { rule: { kind: 'eventType' as const, value: 'OrdenCreada' } },
      { rule: { kind: 'eventType' as const, value: 'x3' } },
      { rule: { kind: 'eventType' as const, value: '/raro' } },
      { rule: { kind: 'eventType' as const, value: 'Orden creada' } },
      { rule: { kind: 'eventType' as const, value: 'path' } },
      { weight: 0.5 },
    ]
    g.edges = rules.map((attrs, i) => ({ id: `e${i}`, source: 'a', target: g.nodes[i + 1].id, ...attrs }))
    const text = printGraphDsl(g)
    expect(text.split('\n').at(-2)).toBe(
      'A --> B [/api x3], C [path api], D [path "/a b"], E [OrdenCreada], F [event x3], G [event /raro], ' +
        'H ["Orden creada"], I [event path], J [x0.5]',
    )
    expectSameGraph(graphOf(text), g)
  })

  it('quotes names that look like syntax', () => {
    const names = ['Data at rest', 'Pagos, Cobros', 'A --> B', 'Say "hi"', 'Pagos as x', 'Lista [1]', 'C # D', ' borde ']
    const g: Graph = {
      nodes: names.map((name, i) => ({ id: `n${i}`, type: 'service', position: { x: 0, y: i * 120 }, config: { name } })),
      edges: names.slice(1).map((_, i) => ({ id: `e${i}`, source: 'n0', target: `n${i + 1}` })),
    }
    const text = printGraphDsl(g)
    expect(text).toContain('service "Data at rest" at 0,0\n')
    expect(text).toContain('service "Say \\"hi\\"" at 0,3\n')
    expect(text).toContain('service "Pagos as x" at 0,4\n')
    expect(roundTrip(g).nodes.map((n) => n.config.name)).toEqual(names)
    expectSameGraph(roundTrip(g), g)
  })

  it('aliases nodes that share a name', () => {
    const g: Graph = {
      nodes: [
        { id: 'web', type: 'client', position: { x: 0, y: 0 }, config: { name: 'Web' } },
        { id: 'api-1', type: 'service', position: { x: 250, y: 0 }, config: { name: 'API' } },
        { id: 'API 2', type: 'service', position: { x: 250, y: 120 }, config: { name: 'API' } },
      ],
      edges: [
        { id: 'a', source: 'web', target: 'api-1' },
        { id: 'b', source: 'web', target: 'API 2' },
      ],
    }
    expect(printGraphDsl(g)).toBe(
      '@architecture v1\n\nclient Web at 0,0\nservice API as api-1 at 1,0\nservice API as api-2 at 1,1\n\nWeb --> api-1, api-2\n',
    )
    expectSameGraph(roundTrip(g), g)
  })

  it('keeps aliases clear of other aliases and names', () => {
    const g: Graph = {
      nodes: [
        { id: 'x', type: 'service', position: { x: 0, y: 0 }, config: { name: 'A' } },
        { id: 'x!', type: 'service', position: { x: 0, y: 120 }, config: { name: 'A' } },
        { id: 'y', type: 'service', position: { x: 0, y: 240 }, config: { name: 'x-2' } },
      ],
      edges: [
        { id: 'a', source: 'x', target: 'y' },
        { id: 'b', source: 'x!', target: 'y' },
      ],
    }
    expectSameGraph(roundTrip(g), g)
  })

  it('prints unknown node types raw', () => {
    const g: Graph = { nodes: [{ id: 'q', type: 'quantum', position: { x: 0, y: 0 }, config: { name: 'Q', spin: 1 } }], edges: [] }
    expect(printGraphDsl(g)).toBe('@architecture v1\n\nquantum Q at 0,0\n')
  })

  it('behavior with tabs and blank lines round-trips', () => {
    const behavior = 'on request /a:\n\n  call B /x\n\tquery DB\n    reply 201\n'
    const g = graphOf('service A\nservice B\ndatabase DB\nA --> B, DB')
    g.nodes[0].config.behavior = behavior
    const text = printGraphDsl(g)
    expect(text).toContain('  behavior:\n    on request /a:\n\n      call B /x\n    \tquery DB\n        reply 201\n')
    expect(roundTrip(g).nodes[0].config.behavior).toBe(behavior)
  })

  for (const lang of ['es', 'en'] as const) {
    for (const preset of getPresets(lang)) {
      it(`presets round-trip: ${lang} ${preset.id}`, () => {
        const text = printGraphDsl(preset.graph)
        const result = parseGraphDsl(text)
        if (!result.ok) throw new Error(`${JSON.stringify(result.errors)}\n${text}`)
        expectSameGraph(result.graph, preset.graph)
        expect(printGraphDsl(result.graph)).toBe(text)
      })
    }
  }
})
