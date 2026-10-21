import { describe, expect, it } from 'vitest'
import { cookieCounter, databaseKindPatch, usesSessionMemory } from '../../src/ui/sessions'
import { uiCopy, uiSignature } from '../../src/ui/runtime/useSimulation'

describe('usesSessionMemory', () => {
  it('finds a session memory step, also inside parallel', () => {
    expect(usesSessionMemory('on request:\n  session memory\n')).toBe(true)
    expect(usesSessionMemory('on request:\n  parallel:\n    session memory\n    wait 10\n')).toBe(true)
  })
  it('is false for jwt, a database, blank or non-text', () => {
    expect(usesSessionMemory('on request:\n  session jwt\n')).toBe(false)
    expect(usesSessionMemory('on request:\n  session Sesiones\n')).toBe(false)
    expect(usesSessionMemory('on request:\n  session "memory"\n')).toBe(false)
    expect(usesSessionMemory('')).toBe(false)
    expect(usesSessionMemory(undefined)).toBe(false)
  })
})

describe('cookieCounter', () => {
  it('client: logged/N with login, or when someone is logged in', () => {
    expect(cookieCounter('client', { users: 5, auth: 'login' }, { cookies: 2 })).toBe('🍪 2/5')
    expect(cookieCounter('client', { users: 5, auth: 'login' }, undefined)).toBe('🍪 0/5')
    expect(cookieCounter('client', {}, undefined)).toBe('🍪 0/1')
    expect(cookieCounter('client', { users: 3, auth: 'none' }, { cookies: 0 })).toBeNull()
    expect(cookieCounter('client', { users: 3, auth: 'none' }, { cookies: 1 })).toBe('🍪 1/3')
  })
  it('service, worker and subscriber: N when the DSL uses session memory or N > 0', () => {
    const mem = { behavior: 'on request:\n  session memory\n' }
    expect(cookieCounter('service', mem, undefined)).toBe('🍪 0')
    expect(cookieCounter('service', mem, { sessions: 4 })).toBe('🍪 4')
    expect(cookieCounter('worker', { behavior: '' }, { sessions: 0 })).toBeNull()
    expect(cookieCounter('subscriber', { behavior: '' }, { sessions: 2 })).toBe('🍪 2')
    expect(cookieCounter('service', { behavior: 'on request:\n  session jwt\n' }, { sessions: 0 })).toBeNull()
  })
  it('database: only when it holds sessions', () => {
    expect(cookieCounter('database', {}, { sessions: 0 })).toBeNull()
    expect(cookieCounter('database', {}, { sessions: 7 })).toBe('🍪 7')
  })
  it('other types: never', () => {
    expect(cookieCounter('load-balancer', {}, { sessions: 3 })).toBeNull()
  })
})

describe('databaseKindPatch', () => {
  it('applies the suggested processingTime when the current one is the previous kind suggestion', () => {
    expect(databaseKindPatch({ kind: 'relational', processingTime: 300 }, 'key-value')).toEqual({ kind: 'key-value', processingTime: 20 })
    expect(databaseKindPatch({ kind: 'key-value', processingTime: 20 }, 'document')).toEqual({ kind: 'document', processingTime: 80 })
    // Old graphs: no kind (relational), no processingTime (the default 300).
    expect(databaseKindPatch({}, 'key-value')).toEqual({ kind: 'key-value', processingTime: 20 })
  })
  it('keeps a customized processingTime', () => {
    expect(databaseKindPatch({ kind: 'relational', processingTime: 500 }, 'key-value')).toEqual({ kind: 'key-value' })
  })
})

describe('uiCopy / uiSignature with sessions', () => {
  it('a client copies only its logged-in count', () => {
    const st = { acc: 0, next: 0, cookies: ['sid:1', null, 'sid:3'] }
    expect(uiCopy(st)).toEqual({ cookies: 2 })
    const sig = uiSignature(st)
    expect(sig).not.toBeNull()
    st.cookies[1] = 'sid:2'
    expect(uiSignature(st)).not.toBe(sig)
  })
  it('a service or a database copies its session count', () => {
    expect(uiCopy({ behaviorPending: {}, sessions: ['a', 'b'] })).toEqual({ sessions: 2 })
    expect(uiSignature({ sessions: [] })).not.toBe(uiSignature({ sessions: ['a'] }))
  })
  it('queues and brokers are unchanged; other states have no signature', () => {
    expect(uiCopy({ items: [] })).toEqual({ items: { head: [], total: 0 } })
    expect(uiCopy({ lanes: {} })).toEqual({ lanes: {} })
    expect(uiSignature({ pending: {} })).toBeNull()
  })
})
