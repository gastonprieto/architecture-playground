import { describe, expect, it } from 'vitest'
import { behaviorStatus, behaviorTargets, graphBehaviorOutputs } from '../../../src/components/behavior/outputs'
import type { Graph } from '../../../src/engine/types'

const node = (id: string, type: string, name?: unknown) => ({ id, type, position: { x: 0, y: 0 }, config: name === undefined ? {} : { name } })

describe('behaviorTargets', () => {
  it('keeps one output per target node, with its trimmed name and type', () => {
    const names: Record<string, unknown> = { a: '  Base de datos ', b: 'Pagos', c: 42 }
    const list = behaviorTargets(
      [
        { target: 'a', targetType: 'database' },
        { target: 'b', targetType: 'service' },
        { target: 'a', targetType: 'database' },
        { target: 'c', targetType: 'queue' },
      ],
      (id) => names[id],
    )
    expect(list).toEqual([
      { target: 'a', name: 'Base de datos', type: 'database' },
      { target: 'b', name: 'Pagos', type: 'service' },
      { target: 'c', name: '', type: 'queue' },
    ])
  })
})

describe('graphBehaviorOutputs', () => {
  it('maps the node outgoing edges like the engine (dedupe by target, target name and type)', () => {
    const graph: Graph = {
      nodes: [node('s', 'service', 'Órdenes'), node('db', 'database', ' Base de datos'), node('p', 'service', 'Pagos'), node('x', 'client', 'C')],
      edges: [
        { id: 'e1', source: 's', target: 'db' },
        { id: 'e2', source: 's', target: 'db' },
        { id: 'e3', source: 's', target: 'p' },
        { id: 'e4', source: 'x', target: 's' },
        { id: 'e5', source: 's', target: 'gone' },
      ],
    }
    expect(graphBehaviorOutputs(graph, 's')).toEqual([
      { name: 'Base de datos', type: 'database' },
      { name: 'Pagos', type: 'service' },
    ])
    expect(graphBehaviorOutputs(graph, 'db')).toEqual([])
  })
})

describe('behaviorStatus', () => {
  const outs = [{ name: 'Base de datos', type: 'database' }]
  it('blank, comment-only or non-string text is the default behavior', () => {
    expect(behaviorStatus('', outs)).toEqual({ kind: 'default' })
    expect(behaviorStatus('  \n\n', outs)).toEqual({ kind: 'default' })
    expect(behaviorStatus('# nada todavía\n  # otro', outs)).toEqual({ kind: 'default' })
    expect(behaviorStatus(undefined, outs)).toEqual({ kind: 'default' })
  })
  it('a valid program is active with its handler count', () => {
    expect(behaviorStatus('on request:\n  query Base de datos\n\non message:\n  reply 200\n', outs)).toEqual({ kind: 'active', handlers: 2 })
  })
  it('errors (parse or validation) win, sorted by line', () => {
    const st = behaviorStatus('on request:\n  query Pagos\n  bogus\n', outs)
    expect(st.kind).toBe('errors')
    if (st.kind !== 'errors') return
    expect(st.errors.map((e) => [e.line, e.code])).toEqual([
      [2, 'not-connected'],
      [3, 'unknown-keyword'],
    ])
  })
  it('a renamed target turns an active program into an error', () => {
    const text = 'on request:\n  query Base de datos\n'
    expect(behaviorStatus(text, outs).kind).toBe('active')
    expect(behaviorStatus(text, [{ name: 'BD', type: 'database' }]).kind).toBe('errors')
  })
})
