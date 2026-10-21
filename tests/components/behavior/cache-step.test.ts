import { describe, expect, it } from 'vitest'
import { compileBehavior, parseBehavior, validateBehavior, type DslError } from '../../../src/components/behavior'
import type { CacheState } from '../../../src/components/cache'
import { defaultRegistry } from '../../../src/components/index'
import { Simulation } from '../../../src/engine/simulation'
import type { Graph, GraphEdge, GraphNode, Message } from '../../../src/engine/types'

/* The DSL `cache X:` block step (docs/cache-spec.md §4). */

const node = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { name: id, ...config },
})
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target })
const codes = (errors: DslError[]) => errors.map((e) => [e.code, e.line])

const OUTPUTS = [
  { name: 'Cache', type: 'cache' },
  { name: 'Base', type: 'database' },
]

describe('cache step: parse', () => {
  it('reads `cache X:` with an indented block', () => {
    const { program, errors } = parseBehavior('on request /productos:\n  cache Cache:\n    query Base\n  reply 200\n')
    expect(errors).toEqual([])
    expect(program.handlers[0].steps).toEqual([
      { kind: 'cache', line: 2, target: 'Cache', steps: [{ kind: 'query', line: 3, target: 'Base' }] },
      { kind: 'reply', line: 4, code: 200 },
    ])
  })

  it('reads quoted targets and the or-modifiers', () => {
    const a = parseBehavior('on request:\n  cache "Mi Cache" or continue:\n    query Base\n')
    expect(a.errors).toEqual([])
    expect(a.program.handlers[0].steps[0]).toMatchObject({ kind: 'cache', target: 'Mi Cache', mod: { kind: 'orContinue' } })
    const b = parseBehavior('on request:\n  cache Mi Cache or reply 504:\n    query Base\n')
    expect(b.errors).toEqual([])
    expect(b.program.handlers[0].steps[0]).toMatchObject({ kind: 'cache', target: 'Mi Cache', mod: { kind: 'orReply', code: 504 } })
  })

  it('nowait → cache-nowait', () => {
    expect(codes(parseBehavior('on request:\n  cache Cache nowait:\n    query Base\n').errors)).toEqual([['cache-nowait', 2]])
  })

  it('an empty block → empty-block; no colon → missing-colon; no target → missing-target', () => {
    expect(codes(parseBehavior('on request:\n  cache Cache:\n  reply 200\n').errors)).toEqual([['empty-block', 2]])
    expect(codes(parseBehavior('on request:\n  cache Cache\n    query Base\n').errors)).toEqual([['missing-colon', 2]])
    expect(codes(parseBehavior('on request:\n  cache:\n    query Base\n').errors)).toEqual([['missing-target', 2]])
  })

  it('outside a handler → step-outside-handler', () => {
    expect(codes(parseBehavior('cache Cache:\n  query Base\n').errors)).toEqual([['step-outside-handler', 1]])
  })
})

describe('cache step: validate', () => {
  const v = (text: string) => validateBehavior(parseBehavior(text).program, OUTPUTS)

  it('a connected Cache is valid; its block is validated too', () => {
    expect(v('on request:\n  cache Cache:\n    query Base\n')).toEqual([])
    expect(codes(v('on request:\n  cache Cache:\n    query Nope\n'))).toEqual([['not-connected', 3]])
  })

  it('not-connected and wrong-verb (with a suggestion)', () => {
    expect(codes(v('on request:\n  cache Nope:\n    query Base\n'))).toEqual([['not-connected', 2]])
    expect(v('on request:\n  cache Base:\n    query Base\n')).toEqual([
      { line: 2, code: 'wrong-verb', params: { verb: 'cache', target: 'Base', type: 'database', suggestion: 'query' } },
    ])
  })

  it('compileBehavior reports parse and validation errors together', () => {
    expect(codes(compileBehavior('on request:\n  cache Cache nowait:\n    query Base\n', OUTPUTS).errors)).toEqual([['cache-nowait', 2]])
  })
})

interface Opts {
  behavior?: string
  cache?: Record<string, unknown>
  db?: Record<string, unknown>
}

const DEFAULT = 'on request:\n  cache Cache:\n    query Base\n  reply 201\n'

/** C → S (DSL) → Cache (leaf), Base (database). */
function setup(opts: Opts = {}) {
  const g: Graph = {
    nodes: [
      node('C', 'client', { mix: [{ value: '/p', weight: 1 }] }),
      node('S', 'service', { processingTime: 100, behavior: opts.behavior ?? DEFAULT }),
      node('Cache', 'cache', { processingTime: 50, ...opts.cache }),
      node('Base', 'database', { processingTime: 100, ...opts.db }),
    ],
    edges: [edge('C', 'S'), edge('S', 'Cache'), edge('S', 'Base')],
  }
  const s = new Simulation(g, { seed: 3, registry: defaultRegistry })
  const responses: Message[] = []
  const log: string[] = []
  s.on('message:arrived', (p) => {
    if (p.at === 'C' && p.msg.kind === 'response') responses.push(p.msg)
    if (p.msg.kind === 'request' && p.at === 'Base') log.push('Base')
    if (p.msg.kind === 'request' && p.at === 'Cache') log.push(`Cache:${p.msg.meta.cacheOp ?? '-'}:${p.msg.meta.cacheKey ?? ''}`)
  })
  const send = () => {
    s.runAction('C', 'send1')
    s.advance(8000)
    const r = responses[responses.length - 1]
    return [r.status, r.code]
  }
  return { s, log, send, keys: () => s.nodeState<CacheState>('Cache').keys.map((k) => k.key), inFlight: () => s.nodeStats('S').inFlight }
}

describe('cache step: run', () => {
  it('a miss runs the block, then sets the key (the path) once, then goes on', () => {
    const t = setup()
    expect(t.send()).toEqual(['ok', 201])
    expect(t.log).toEqual(['Cache:get:/p', 'Base', 'Cache:set:/p'])
    expect(t.keys()).toEqual(['/p'])
    expect(t.inFlight()).toBe(0)
  })

  it('the set is fire-and-forget: the reply does not wait for it; the key is stored afterwards', () => {
    const t = setup()
    const times: number[] = []
    t.s.on('message:arrived', (p) => {
      if (p.at === 'C' && p.msg.kind === 'response') times.push(t.s.now)
    })
    t.s.runAction('C', 'send1')
    t.s.advance(3850)
    // C→S 600, S 100, get 600+50+600, Base 600+100+600, S→C 600.
    expect(times).toEqual([3850])
    expect(t.keys()).toEqual([])
    t.s.advance(3000)
    expect(t.keys()).toEqual(['/p'])
    expect(t.inFlight()).toBe(0)
    expect(Object.keys(t.s.nodeState<{ behaviorPending: object }>('S').behaviorPending)).toEqual([])
  })

  it('a MISS is not an error: a hand-written `query Cache` succeeds and the cache counts no error', () => {
    const t = setup({ behavior: 'on request:\n  query Cache\n  reply 201\n' })
    expect(t.send()).toEqual(['ok', 201])
    expect(t.s.nodeStats('Cache')).toMatchObject({ errors: 0 })
  })

  it('a hit skips the block', () => {
    const t = setup()
    t.send()
    expect(t.send()).toEqual(['ok', 201])
    expect(t.log).toEqual(['Cache:get:/p', 'Base', 'Cache:set:/p', 'Cache:get:/p'])
    expect(t.inFlight()).toBe(0)
  })

  it('a failing step in the block → 502, no set', () => {
    const t = setup({ db: { up: false } })
    expect(t.send()).toEqual(['error', 502])
    expect(t.log).toEqual(['Cache:get:/p', 'Base'])
    expect(t.keys()).toEqual([])
    expect(t.inFlight()).toBe(0)
  })

  it('a block step with `or reply` ends the handler with that code, no set', () => {
    const t = setup({ db: { up: false }, behavior: 'on request:\n  cache Cache:\n    query Base or reply 504\n  reply 201\n' })
    expect(t.send()).toEqual(['error', 504])
    expect(t.log).toEqual(['Cache:get:/p', 'Base'])
    expect(t.inFlight()).toBe(0)
  })

  it('a reply inside the block ends the handler without set', () => {
    const t = setup({ behavior: 'on request:\n  cache Cache:\n    query Base\n    reply 202\n  reply 201\n' })
    expect(t.send()).toEqual(['ok', 202])
    expect(t.log).toEqual(['Cache:get:/p', 'Base'])
    expect(t.keys()).toEqual([])
    expect(t.inFlight()).toBe(0)
  })

  it('a down cache fails the step: 503 by default, the block does not run', () => {
    const t = setup({ cache: { up: false } })
    expect(t.send()).toEqual(['error', 503])
    expect(t.log).toEqual(['Cache:get:/p'])
    expect(t.inFlight()).toBe(0)
  })

  it('a down cache with `or reply N` replies N', () => {
    const t = setup({ cache: { up: false }, behavior: 'on request:\n  cache Cache or reply 500:\n    query Base\n  reply 201\n' })
    expect(t.send()).toEqual(['error', 500])
    expect(t.inFlight()).toBe(0)
  })

  it('a down cache with `or continue` runs the block as a miss, without set', () => {
    const t = setup({ cache: { up: false }, behavior: 'on request:\n  cache Cache or continue:\n    query Base\n  reply 201\n' })
    expect(t.send()).toEqual(['ok', 201])
    expect(t.log).toEqual(['Cache:get:/p', 'Base'])
    expect(t.inFlight()).toBe(0)
  })

  it('a cache deleted mid-flight frees the slot (treated as a cache failure)', () => {
    const t = setup()
    t.s.runAction('C', 'send1')
    t.s.advance(800) // the get is on its way to the cache
    t.s.setGraph({
      nodes: [node('C', 'client', { mix: [{ value: '/p', weight: 1 }] }), node('S', 'service', { processingTime: 100, behavior: DEFAULT }), node('Base', 'database')],
      edges: [edge('C', 'S'), edge('S', 'Base')],
    })
    t.s.advance(8000)
    expect(t.inFlight()).toBe(0)
  })

  it('works inside parallel and keeps one set per successful miss', () => {
    const t = setup({ behavior: 'on request:\n  parallel:\n    cache Cache:\n      query Base\n    wait 10\n  reply 201\n' })
    expect(t.send()).toEqual(['ok', 201])
    expect(t.log.filter((l) => l.startsWith('Cache:set'))).toHaveLength(1)
  })
})

describe('cache step: read-through target', () => {
  it('a downstream 404 coming back through a read-through Cache is a cache failure, not a miss', () => {
    const g: Graph = {
      nodes: [
        node('C', 'client', { mix: [{ value: '/p', weight: 1 }] }),
        node('S', 'service', { processingTime: 100, behavior: 'on request:\n  cache Cache:\n    query Base\n  reply 201\n' }),
        node('Cache', 'cache', { processingTime: 50 }),
        node('Origin', 'service', { processingTime: 100, behavior: 'on request:\n  reply 404\n' }),
        node('Base', 'database', { processingTime: 100 }),
      ],
      edges: [edge('C', 'S'), edge('S', 'Cache'), edge('Cache', 'Origin'), edge('S', 'Base')],
    }
    const s = new Simulation(g, { seed: 3, registry: defaultRegistry })
    const responses: Message[] = []
    let atOrigin: Message | undefined
    s.on('message:arrived', (p) => {
      if (p.at === 'C' && p.msg.kind === 'response') responses.push(p.msg)
      if (p.at === 'Origin' && p.msg.kind === 'request') atOrigin = p.msg
    })
    s.runAction('C', 'send1')
    s.advance(10_000)
    expect(responses.map((r) => r.code)).toEqual([503])
    expect(s.nodeStats('Base').ok).toBe(0)
    // The read-through cache forwarded a plain request.
    expect(atOrigin?.meta.cacheOp).toBeUndefined()
  })
})
