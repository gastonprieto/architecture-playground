import { describe, expect, it } from 'vitest'
import { DB_KIND_DEFAULTS, database, type DatabaseState } from '../../src/components/database'
import { defaultRegistry } from '../../src/components/index'
import { defaultConfig } from '../../src/engine/registry'
import { Simulation } from '../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../src/engine/types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ nodes, edges })

/** A request as if it came from node X one hop upstream (so the database can reply to it). */
let seq = 0
const req = (meta: Message['meta']): Message => ({ id: `t${++seq}`, kind: 'request', meta, trail: ['X'], createdAt: 0 })

function setup(dbConfig: Record<string, unknown> = {}) {
  const g = (cfg: Record<string, unknown>) => graph([node('X', 'service'), node('D', 'database', { ...dbConfig, ...cfg })], [edge('X', 'D')])
  const s = new Simulation(g({}), { seed: 1, registry: defaultRegistry })
  const replies: Message[] = []
  s.on('message:sent', (p) => {
    if (p.from === 'D' && p.msg.kind === 'response') replies.push(p.msg)
  })
  const sessions = () => s.nodeState<DatabaseState>('D').sessions
  const op = (sessionOp: 'check' | 'create', sessionId: string) => s.inject('D', req({ sessionOp, sessionId }))
  return { s, replies, sessions, op, setUp: (up: boolean) => s.setGraph(g({ up })) }
}

describe('database kind', () => {
  it('has a kind select (relational | key-value | document), default relational', () => {
    const f = database.config.kind
    expect(f).toMatchObject({ type: 'select', default: 'relational' })
    expect(f.type === 'select' && f.options.map((o) => o.value)).toEqual(['relational', 'key-value', 'document'])
    expect(defaultConfig(database).processingTime).toBe(300)
  })

  it('exports the suggested processing time and icon per kind', () => {
    expect(DB_KIND_DEFAULTS).toEqual({
      relational: { processingTime: 300, icon: '🛢️' },
      'key-value': { processingTime: 20, icon: '🗝️' },
      document: { processingTime: 80, icon: '📄' },
    })
  })

  it('iconFor returns the icon of the kind (relational when missing or unknown)', () => {
    expect(database.iconFor).toBeDefined()
    expect(database.iconFor!({ ...defaultConfig(database), kind: 'key-value' } as never)).toBe('🗝️')
    expect(database.iconFor!({ ...defaultConfig(database), kind: 'document' } as never)).toBe('📄')
    expect(database.iconFor!({ ...defaultConfig(database), kind: 'relational' } as never)).toBe('🛢️')
    expect(database.iconFor!({} as never)).toBe('🛢️')
    expect(database.icon).toBe('🛢️')
  })
})

describe('database sessions', () => {
  it('a plain query is unchanged: 200 after processingTime, no sessions stored', () => {
    const { s, replies, sessions } = setup()
    s.inject('D', req({ path: '/' }))
    s.advance(299)
    expect(replies).toHaveLength(0)
    s.advance(1)
    expect(replies.map((r) => [r.status, r.code])).toEqual([['ok', 200]])
    expect(sessions()).toEqual([])
  })

  it('check answers 404 for an unknown session, create stores it (200) and then check answers 200', () => {
    const { s, replies, sessions, op } = setup()
    op('check', 'sid:a')
    s.advance(300)
    expect(replies.map((r) => r.code)).toEqual([404])
    op('create', 'sid:a')
    s.advance(299)
    expect(sessions()).toEqual([]) // created only after processingTime
    s.advance(1)
    expect(sessions()).toEqual(['sid:a'])
    op('check', 'sid:a')
    op('check', 'sid:b')
    s.advance(300)
    expect(replies.map((r) => r.code)).toEqual([404, 200, 200, 404])
    // Creating twice keeps one entry.
    op('create', 'sid:a')
    s.advance(300)
    expect(sessions()).toEqual(['sid:a'])
  })

  it('session ops go through processing: a down database answers 503', () => {
    const { s, replies, op, setUp } = setup()
    setUp(false)
    op('check', 'sid:a')
    expect(replies.map((r) => r.code)).toEqual([503])
    s.advance(1000)
  })

  it('a key-value database loses its sessions on off→on (tick in between)', () => {
    const { s, sessions, op, setUp } = setup({ kind: 'key-value', processingTime: 20 })
    op('create', 'sid:a')
    s.advance(100)
    expect(sessions()).toEqual(['sid:a'])
    setUp(false)
    s.advance(300)
    setUp(true)
    s.advance(100)
    expect(sessions()).toEqual([])
  })

  it('a key-value database loses its sessions on off→on while paused or within one tick', () => {
    const { s, sessions, op, setUp } = setup({ kind: 'key-value', processingTime: 20 })
    op('create', 'sid:a')
    s.advance(20)
    expect(sessions()).toEqual(['sid:a'])
    // Paused: no time passes between the two toggles.
    setUp(false)
    setUp(true)
    expect(sessions()).toEqual([])
    op('create', 'sid:b')
    s.advance(20)
    // Within one tick: no onTick runs between the toggles.
    setUp(false)
    s.advance(10)
    setUp(true)
    s.advance(10)
    expect(sessions()).toEqual([])
  })

  it('relational and document databases keep their sessions on off→on', () => {
    for (const kind of ['relational', 'document']) {
      const { s, sessions, op, setUp } = setup({ kind })
      op('create', 'sid:a')
      s.advance(300)
      setUp(false)
      s.advance(300)
      setUp(true)
      s.advance(300)
      expect(sessions(), kind).toEqual(['sid:a'])
    }
  })

  it('a create still in process when the database restarts is stored after the restart (work in flight finishes)', () => {
    const { s, sessions, op, setUp } = setup({ kind: 'key-value', processingTime: 20 })
    op('create', 'sid:a')
    s.advance(10)
    setUp(false)
    setUp(true)
    s.advance(10)
    expect(sessions()).toEqual(['sid:a'])
  })

  it('create without a string sessionId answers 400 and stores nothing', () => {
    const { s, replies, sessions } = setup()
    s.inject('D', req({ sessionOp: 'create' }))
    s.inject('D', req({ sessionOp: 'create', sessionId: 42 as unknown as string }))
    s.advance(300)
    expect(replies.map((r) => [r.status, r.code])).toEqual([
      ['error', 400],
      ['error', 400],
    ])
    expect(sessions()).toEqual([])
  })
})
