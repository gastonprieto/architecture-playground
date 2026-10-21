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
