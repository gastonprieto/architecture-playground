import { describe, expect, it } from 'vitest'
import { cacheCounters } from '../../src/ui/cacheCounters'
import { uiCopy, uiSignature } from '../../src/ui/runtime/useSimulation'

const cacheState = (keys: number, hits: number, misses: number) => ({
  keys: Array.from({ length: keys }, (_, i) => ({ key: `/k${i}`, at: 0 })),
  hits,
  misses,
})

describe('cache counters in the UI state (counts only)', () => {
  it('uiCopy carries the key count and the hit/miss counts, not the keys', () => {
    expect(uiCopy(cacheState(3, 5, 2))).toEqual({ cacheKeys: 3, cacheHits: 5, cacheMisses: 2 })
    // A proxy state has more fields; only the counts are copied.
    expect(uiCopy({ window: [1], issue: {}, store: {}, ...cacheState(1, 0, 1) })).toEqual({ cacheKeys: 1, cacheHits: 0, cacheMisses: 1 })
  })

  it('uiSignature changes with the counts only', () => {
    const a = uiSignature(cacheState(2, 1, 1))
    expect(a).toBe(uiSignature(cacheState(2, 1, 1)))
    expect(uiSignature(cacheState(3, 1, 1))).not.toBe(a)
    expect(uiSignature(cacheState(2, 2, 1))).not.toBe(a)
    expect(uiSignature(cacheState(2, 1, 2))).not.toBe(a)
  })
})

describe('cacheCounters', () => {
  const ui = { cacheKeys: 3, cacheHits: 3, cacheMisses: 1 }

  it('a Cache in keys mode (the default) shows 🔑 N and the real hit %', () => {
    expect(cacheCounters('cache', { mode: 'keys' }, ui)).toEqual({ keys: '🔑 3', hit: 'hit 75%' })
    expect(cacheCounters('cache', {}, ui)).toEqual({ keys: '🔑 3', hit: 'hit 75%' })
  })

  it('no hit % before the first lookup', () => {
    expect(cacheCounters('cache', { mode: 'keys' }, undefined)).toEqual({ keys: '🔑 0', hit: null })
    expect(cacheCounters('cache', { mode: 'keys' }, { cacheKeys: 0, cacheHits: 0, cacheMisses: 0 })).toEqual({ keys: '🔑 0', hit: null })
  })

  it('rounds the hit %', () => {
    expect(cacheCounters('cache', {}, { cacheKeys: 1, cacheHits: 2, cacheMisses: 1 }).hit).toBe('hit 67%')
    expect(cacheCounters('cache', {}, { cacheKeys: 1, cacheHits: 0, cacheMisses: 4 }).hit).toBe('hit 0%')
  })

  it('a Cache in random mode shows only the hit %', () => {
    expect(cacheCounters('cache', { mode: 'random' }, ui)).toEqual({ keys: null, hit: 'hit 75%' })
  })

  it('a reverse proxy shows them only with its cache in real keys', () => {
    expect(cacheCounters('reverse-proxy', { cache: 'keys' }, ui)).toEqual({ keys: '🔑 3', hit: 'hit 75%' })
    expect(cacheCounters('reverse-proxy', { cache: 'random' }, ui)).toEqual({ keys: null, hit: null })
    expect(cacheCounters('reverse-proxy', {}, ui)).toEqual({ keys: null, hit: null })
  })

  it('other components show nothing', () => {
    expect(cacheCounters('service', {}, ui)).toEqual({ keys: null, hit: null })
  })
})
