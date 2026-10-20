import { describe, expect, it } from 'vitest'
import { matchesEvent, matchesPath, ruleLabel } from '../../src/engine/rules'
import type { EdgeRule } from '../../src/engine/types'

const path = (value: string): EdgeRule => ({ kind: 'pathPrefix', value })
const event = (value: string): EdgeRule => ({ kind: 'eventType', value })

describe('matchesPath', () => {
  it('returns the matched prefix length', () => {
    expect(matchesPath(path('/ordenes'), '/ordenes/envios')).toBe(8)
  })
  it('returns -1 when the prefix does not match', () => {
    expect(matchesPath(path('/ordenes'), '/usuarios')).toBe(-1)
  })
  it('treats a missing rule as "/"', () => {
    expect(matchesPath(undefined, '/x')).toBe(1)
  })
  it('never matches an eventType rule', () => {
    expect(matchesPath(event('A'), '/x')).toBe(-1)
  })
})

describe('matchesEvent', () => {
  it('matches everything without a rule', () => {
    expect(matchesEvent(undefined, 'A')).toBe(true)
  })
  it('compares eventType rules', () => {
    expect(matchesEvent(event('A'), 'A')).toBe(true)
    expect(matchesEvent(event('A'), 'B')).toBe(false)
  })
  it('never matches a pathPrefix rule', () => {
    expect(matchesEvent(path('/'), 'A')).toBe(false)
  })
})

describe('ruleLabel', () => {
  it('formats the three forms', () => {
    expect(ruleLabel()).toBe('')
    expect(ruleLabel(path('/ordenes'))).toBe('/ordenes*')
    expect(ruleLabel(event('OrdenCreada'))).toBe('OrdenCreada')
  })
})
