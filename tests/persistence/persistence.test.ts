import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Graph } from '../../src/engine/types'
import { getPresets } from '../../src/presets'
import { decodeHash, encodeHash } from '../../src/persistence/hash'
import { clearLocationHash, initialGraph } from '../../src/persistence/initial'
import { parseGraph, serializeGraph } from '../../src/persistence/serialize'
import { loadLocal, saveLocal } from '../../src/persistence/storage'

const g: Graph = {
  nodes: [
    { id: 'a', type: 'client', position: { x: 1, y: 2 }, config: { rps: 3 } },
    { id: 'b', type: 'mystery-type', position: { x: 3, y: 4 }, config: {} },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b', rule: { kind: 'pathPrefix', value: '/x' } }],
}
const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}
const node = (id: string, type: string) => ({ id, type, position: { x: 0, y: 0 }, config: {} })
afterEach(() => vi.unstubAllGlobals())

describe('serialize/parse', () => {
  it('round-trips and accepts unknown node types', () => {
    expect(parseGraph(serializeGraph(g))).toEqual({ ok: true, graph: g })
  })
  it('reports invalid JSON', () => {
    expect(parseGraph('{nope')).toEqual({ ok: false, error: 'invalid-json' })
  })
  it('reports unrecognized format', () => {
    const bad = (x: unknown) => expect(parseGraph(JSON.stringify(x))).toEqual({ ok: false, error: 'unknown-format' })
    bad({ version: 2, graph: g })
    bad({ version: 1, graph: { nodes: 'x', edges: [] } })
    bad({ version: 1, graph: { nodes: [{ id: 'a' }], edges: [] } })
    bad({ version: 1, graph: { nodes: [], edges: [{ id: 'e', source: 'a', target: 'b', rule: { kind: 'nope', value: 'x' } }] } })
    bad(null)
  })
  it('round-trips edge weights; graphs without weights still load', () => {
    const g: Graph = { nodes: [node('a', 'load-balancer'), node('b', 'service'), node('c', 'service')], edges: [
      { id: 'e1', source: 'a', target: 'b', weight: 3 },
      { id: 'e2', source: 'a', target: 'c', weight: 0 },
    ] }
    expect(parseGraph(serializeGraph(g))).toEqual({ ok: true, graph: g })
    const old: Graph = { ...g, edges: [{ id: 'e1', source: 'a', target: 'b' }] }
    expect(parseGraph(serializeGraph(old))).toEqual({ ok: true, graph: old })
  })

  it('rejects an invalid edge weight', () => {
    for (const weight of [-1, 'x', null, Number.POSITIVE_INFINITY]) {
      const text = JSON.stringify({ version: 1, graph: { nodes: [node('a', 'x'), node('b', 'x')], edges: [{ id: 'e', source: 'a', target: 'b', weight }] } })
      expect(parseGraph(text), String(weight)).toEqual({ ok: false, error: 'unknown-format' })
    }
  })

  it('drops an invalid client color or ip on import (so the UI backfills them)', () => {
    const text = JSON.stringify({
      version: 1,
      graph: {
        nodes: [
          { id: 'a', type: 'client', position: { x: 0, y: 0 }, config: { name: 'A', color: 'red', ip: 7 } },
          { id: 'b', type: 'client', position: { x: 0, y: 0 }, config: { name: 'B', color: '#AbCdEf', ip: '' } },
          { id: 's', type: 'service', position: { x: 0, y: 0 }, config: { color: 'whatever' } },
        ],
        edges: [],
      },
    })
    const r = parseGraph(text)
    expect(r.ok).toBe(true)
    const cfg = (id: string) => (r.ok ? r.graph.nodes.find((x) => x.id === id)!.config : null)
    expect(cfg('a')).toEqual({ name: 'A' })
    expect(cfg('b')).toEqual({ name: 'B', color: '#AbCdEf', ip: '' })
    expect(cfg('s')).toEqual({ color: 'whatever' })
  })

  it('reports edges pointing at missing nodes', () => {
    const r = parseGraph(JSON.stringify({ version: 1, graph: { nodes: g.nodes, edges: [{ id: 'e9', source: 'a', target: 'zzz' }] } }))
    expect(r).toEqual({ ok: false, error: 'dangling-edge', edgeId: 'e9' })
  })
  it('every preset survives parseGraph(serializeGraph(g))', () => {
    for (const p of getPresets('es')) expect(parseGraph(serializeGraph(p.graph))).toEqual({ ok: true, graph: p.graph })
  })
})

describe('hash', () => {
  it('round-trips', () => {
    const h = encodeHash(g)
    expect(h.startsWith('#g=')).toBe(true)
    expect(decodeHash(h)).toEqual(g)
  })
  it('returns null for garbage', () => {
    expect(decodeHash('#g=garbage')).toBeNull()
    expect(decodeHash('')).toBeNull()
    expect(decodeHash('#other=1')).toBeNull()
  })
})

describe('local storage', () => {
  it('saves and loads', () => {
    vi.stubGlobal('localStorage', mem())
    saveLocal(g)
    expect(loadLocal()).toEqual(g)
  })
  it('never throws when localStorage throws', () => {
    const boom = () => { throw new Error('denied') }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom })
    expect(loadLocal()).toBeNull()
    expect(() => saveLocal(g)).not.toThrow()
  })
  it('loadLocal returns null for corrupt data', () => {
    const s = mem()
    s.setItem('architecture-playground:graph', 'zzz')
    vi.stubGlobal('localStorage', s)
    expect(loadLocal()).toBeNull()
  })
})

describe('initialGraph', () => {
  const other: Graph = { nodes: [], edges: [] }
  it('prefers the URL hash, then localStorage, then the load-balancer preset', () => {
    const s = mem()
    vi.stubGlobal('localStorage', s)
    expect(initialGraph('es', '')).toEqual(getPresets('es').find((p) => p.id === 'load-balancer')!.graph)
    expect(initialGraph('en', '')).toEqual(getPresets('en').find((p) => p.id === 'load-balancer')!.graph)
    saveLocal(g)
    expect(initialGraph('es', '')).toEqual(g)
    expect(initialGraph('es', encodeHash(other))).toEqual(other)
    expect(initialGraph('es', '#g=garbage')).toEqual(g)
  })

  it('reports a successful hash load so the caller can clear the hash (once only)', () => {
    vi.stubGlobal('localStorage', mem())
    const loaded = vi.fn()
    initialGraph('es', '', loaded)
    initialGraph('es', '#g=garbage', loaded)
    expect(loaded).not.toHaveBeenCalled()
    expect(initialGraph('es', encodeHash(other), loaded)).toEqual(other)
    expect(loaded).toHaveBeenCalledTimes(1)
  })

  it('clearLocationHash replaces the URL with path + query, without the hash', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('history', { replaceState })
    vi.stubGlobal('location', { pathname: '/architecture-playground/', search: '?x=1', hash: '#g=abc' })
    clearLocationHash()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/architecture-playground/?x=1')
  })
})
