import { beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../../src/engine/registry'
import { defaultRegistry } from '../../src/components/index'
import { useEditor } from '../../src/ui/store/editor'

const s = () => useEditor.getState()
beforeEach(() => s().loadGraph({ nodes: [], edges: [] }))

describe('editor store', () => {
  it('addNode fills in the default config', () => {
    const id = s().addNode('service', { x: 1, y: 2 })
    expect(id).toMatch(/^service-[a-z0-9]{6}$/)
    const n = s().graph.nodes.find((x) => x.id === id)!
    expect(n.config).toEqual(defaultConfig(defaultRegistry.get('service')!))
    expect(n.position).toEqual({ x: 1, y: 2 })
  })

  it('connect rejects self-loops and duplicates', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const b = s().addNode('service', { x: 0, y: 0 })
    expect(s().connect(a, a)).toBeNull()
    expect(s().connect(a, b)).toBeTruthy()
    expect(s().connect(a, b)).toBeNull()
    expect(s().graph.edges).toHaveLength(1)
  })

  it('removing a node cascades to its edges and clears selection', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const b = s().addNode('service', { x: 0, y: 0 })
    s().connect(a, b)
    s().select({ kind: 'node', id: b })
    s().removeElements([b])
    expect(s().graph.nodes.map((n) => n.id)).toEqual([a])
    expect(s().graph.edges).toHaveLength(0)
    expect(s().selection).toBeNull()
  })

  it('undo/redo restore graphs', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    s().updateNodeConfig(a, { foo: 1 })
    s().undo()
    expect(s().graph.nodes[0].config.foo).toBeUndefined()
    s().undo()
    expect(s().graph.nodes).toHaveLength(0)
    s().redo()
    expect(s().graph.nodes).toHaveLength(1)
    s().redo()
    expect(s().graph.nodes[0].config.foo).toBe(1)
    s().undo()
    s().addNode('client', { x: 0, y: 0 })
    expect(s().future).toHaveLength(0)
  })

  it('setEdgeRule sets and clears a rule', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const b = s().addNode('service', { x: 0, y: 0 })
    const e = s().connect(a, b)!
    s().setEdgeRule(e, { kind: 'pathPrefix', value: '/x' })
    expect(s().graph.edges[0].rule).toEqual({ kind: 'pathPrefix', value: '/x' })
    s().setEdgeRule(e, undefined)
    expect(s().graph.edges[0].rule).toBeUndefined()
  })

  it('moveNode(commit=false) does not add history; commit=true does', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const before = s().past.length
    s().moveNode(a, { x: 5, y: 5 }, false)
    expect(s().past.length).toBe(before)
    expect(s().graph.nodes[0].position).toEqual({ x: 5, y: 5 })
    s().moveNode(a, { x: 9, y: 9 }, true)
    expect(s().past.length).toBe(before + 1)
  })

  it('caps history at 100', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    for (let i = 0; i < 150; i++) s().updateNodeConfig(a, { i })
    expect(s().past).toHaveLength(100)
  })

  it('select does not touch history; loadGraph clears it', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const n = s().past.length
    s().select({ kind: 'node', id: a })
    expect(s().past.length).toBe(n)
    s().loadGraph({ nodes: [], edges: [] })
    expect(s().past).toHaveLength(0)
    expect(s().future).toHaveLength(0)
  })

  const pos = () => s().graph.nodes[0].position

  it('a drag then commit undoes in a single step to the pre-drag position', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const n = s().past.length
    s().moveNode(a, { x: 1, y: 1 }, false)
    s().moveNode(a, { x: 2, y: 2 }, false)
    s().moveNode(a, { x: 3, y: 3 }, true)
    expect(s().past.length).toBe(n + 1)
    s().undo()
    expect(pos()).toEqual({ x: 0, y: 0 })
  })

  it('an uncommitted drag followed by another mutation does not leak a stale base', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    s().moveNode(a, { x: 5, y: 5 }, false)
    s().updateNodeConfig(a, { k: 1 })
    expect(s().dragBase).toBeNull()
    s().undo()
    expect(pos()).toEqual({ x: 5, y: 5 })
    expect(s().graph.nodes[0].config.k).toBeUndefined()
  })

  it('undo mid-drag then commit keeps history consistent', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    s().updateNodeConfig(a, { k: 1 })
    s().moveNode(a, { x: 5, y: 5 }, false)
    s().undo()
    expect(s().graph.nodes[0].config.k).toBeUndefined()
    s().moveNode(a, { x: 7, y: 7 }, true)
    s().undo()
    expect(pos()).toEqual({ x: 0, y: 0 })
    expect(s().graph.nodes[0].config.k).toBeUndefined()
  })

  it('a commit for a different node does not use the drag base of another node', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const b = s().addNode('client', { x: 10, y: 10 })
    s().moveNode(a, { x: 5, y: 5 }, false)
    s().moveNode(b, { x: 20, y: 20 }, true)
    s().undo()
    expect(s().graph.nodes.find((x) => x.id === a)!.position).toEqual({ x: 5, y: 5 })
    expect(s().graph.nodes.find((x) => x.id === b)!.position).toEqual({ x: 10, y: 10 })
  })

  it('no-op mutations do not push history; undo clears a dangling selection', () => {
    const a = s().addNode('client', { x: 0, y: 0 })
    const n = s().past.length
    s().removeElements([])
    s().moveNode('nope', { x: 1, y: 1 }, true)
    s().updateNodeConfig('nope', { a: 1 })
    s().setEdgeRule('nope', undefined)
    expect(s().past.length).toBe(n)
    s().select({ kind: 'node', id: a })
    s().undo()
    expect(s().selection).toBeNull()
  })
})
