import { describe, expect, it } from 'vitest'
import type { Graph, GraphNode } from '../../src/engine/types'
import { migrateGraph, prepareGraph } from '../../src/ui/graphEntry'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })

describe('migrateGraph (authFailRate → auth, sessions spec §8)', () => {
  it('a reverse proxy with authFailRate > 0 gets auth credentials and loses the old field', () => {
    const g: Graph = { nodes: [node('P', 'reverse-proxy', { name: 'P', authFailRate: 0.3, rateLimit: 5 })], edges: [] }
    const out = migrateGraph(g)
    expect(out.nodes[0].config).toEqual({ name: 'P', auth: 'credentials', rateLimit: 5 })
    // Pure: the input is untouched.
    expect(g.nodes[0].config.authFailRate).toBe(0.3)
  })

  it('authFailRate 0 (or not a number) is just dropped, keeping any auth already set', () => {
    const g: Graph = {
      nodes: [
        node('P', 'reverse-proxy', { authFailRate: 0 }),
        node('Q', 'reverse-proxy', { authFailRate: 'x', auth: 'jwt' }),
        node('R', 'reverse-proxy', { authFailRate: -1 }),
      ],
      edges: [],
    }
    expect(migrateGraph(g).nodes.map((n) => n.config)).toEqual([{}, { auth: 'jwt' }, {}])
  })

  it('a positive authFailRate wins over an auth none already there', () => {
    const g: Graph = { nodes: [node('P', 'reverse-proxy', { authFailRate: 1, auth: 'none' })], edges: [] }
    expect(migrateGraph(g).nodes[0].config).toEqual({ auth: 'credentials' })
  })

  it('returns the same graph when nothing needs migrating; other types keep an authFailRate key', () => {
    const g: Graph = { nodes: [node('P', 'reverse-proxy', { auth: 'jwt' }), node('X', 'service', { authFailRate: 1 })], edges: [] }
    expect(migrateGraph(g)).toBe(g)
  })

  it('prepareGraph composes the migration with the client backfill', () => {
    const g: Graph = { nodes: [node('C', 'client', { name: 'C' }), node('P', 'reverse-proxy', { authFailRate: 0.5 })], edges: [] }
    const out = prepareGraph(g)
    expect(out.nodes[0].config.ip).toBe('10.0.0.1')
    expect(typeof out.nodes[0].config.color).toBe('string')
    expect(out.nodes[1].config).toEqual({ auth: 'credentials' })
  })
})

describe('migrateGraph (cache-spec §2.2 Cache mode, §5 proxy cacheHitRate)', () => {
  it('a Cache without mode becomes random, keeping its hitRate', () => {
    const g: Graph = { nodes: [node('K', 'cache', { name: 'K', hitRate: 0.6 }), node('L', 'cache', {})], edges: [] }
    const out = migrateGraph(g)
    expect(out.nodes.map((n) => n.config)).toEqual([{ name: 'K', hitRate: 0.6, mode: 'random' }, { mode: 'random' }])
    expect('mode' in g.nodes[0].config).toBe(false)
  })

  it('a Cache with a mode is left alone', () => {
    const g: Graph = { nodes: [node('K', 'cache', { mode: 'keys', capacity: 5 })], edges: [] }
    expect(migrateGraph(g)).toBe(g)
  })

  it('a proxy cacheHitRate > 0 becomes a random edge cache over every path; the old field is dropped', () => {
    const g: Graph = { nodes: [node('P', 'reverse-proxy', { name: 'P', cacheHitRate: 0.3, rateLimit: 2 })], edges: [] }
    expect(migrateGraph(g).nodes[0].config).toEqual({ name: 'P', rateLimit: 2, cache: 'random', hitRate: 0.3, cacheablePaths: [] })
    expect(g.nodes[0].config.cacheHitRate).toBe(0.3)
  })

  it('a proxy cacheHitRate of 0 (or not a number) becomes cache off, keeping a cache already set', () => {
    const g: Graph = {
      nodes: [node('P', 'reverse-proxy', { cacheHitRate: 0 }), node('Q', 'reverse-proxy', { cacheHitRate: 'x', cache: 'keys' })],
      edges: [],
    }
    expect(migrateGraph(g).nodes.map((n) => n.config)).toEqual([{ cache: 'off' }, { cache: 'keys' }])
  })

  it('both proxy migrations compose on the same node', () => {
    const g: Graph = { nodes: [node('P', 'reverse-proxy', { authFailRate: 0.5, cacheHitRate: 0.2 })], edges: [] }
    expect(migrateGraph(g).nodes[0].config).toEqual({ auth: 'credentials', cache: 'random', hitRate: 0.2, cacheablePaths: [] })
  })

  it('is idempotent: migrating a migrated graph returns it unchanged (same object)', () => {
    const g: Graph = {
      nodes: [
        node('K', 'cache', { hitRate: 0.6 }),
        node('P', 'reverse-proxy', { authFailRate: 0.5, cacheHitRate: 0.2 }),
        node('S', 'service', { cacheHitRate: 1 }),
      ],
      edges: [],
    }
    const once = migrateGraph(g)
    expect(migrateGraph(once)).toBe(once)
    expect(once.nodes[2].config).toEqual({ cacheHitRate: 1 })
    expect(prepareGraph(prepareGraph(g))).toEqual(prepareGraph(g))
  })
})
