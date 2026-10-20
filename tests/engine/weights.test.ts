import { describe, expect, it } from 'vitest'
import { effectiveWeights, sharePercents } from '../../src/engine/weights'

describe('connection weights', () => {
  it('missing or invalid weights count as 1; all zero → equal', () => {
    expect(effectiveWeights([undefined, 3, -1, Number.NaN])).toEqual([1, 3, 1, 1])
    expect(effectiveWeights([0, 0, 0])).toEqual([1, 1, 1])
    expect(effectiveWeights([0, 2])).toEqual([0, 2])
    expect(effectiveWeights([])).toEqual([])
  })

  it('sharePercents normalizes and rounds', () => {
    expect(sharePercents([60, 30, 10])).toEqual([60, 30, 10])
    expect(sharePercents([7, 3])).toEqual([70, 30])
    expect(sharePercents([undefined, undefined, undefined])).toEqual([33, 33, 33])
    expect(sharePercents([3, 0, 1])).toEqual([75, 0, 25])
    expect(sharePercents([0, 0])).toEqual([50, 50])
  })
})
