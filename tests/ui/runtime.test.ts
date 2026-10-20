import { describe, expect, it } from 'vitest'
import { formatMetrics } from '../../src/ui/MetricsBar'
import { SPEEDS, cycleSpeed, stepSpeed } from '../../src/ui/runtime/runtimeStore'

describe('speeds', () => {
  it('SPEEDS', () => expect(SPEEDS).toEqual([0.25, 0.5, 1, 2, 4]))

  it('stepSpeed moves one step and clamps at both ends', () => {
    expect(stepSpeed(1, 1)).toBe(2)
    expect(stepSpeed(1, -1)).toBe(0.5)
    expect(stepSpeed(4, 1)).toBe(4)
    expect(stepSpeed(0.25, -1)).toBe(0.25)
  })

  it('cycleSpeed wraps around', () => {
    expect(cycleSpeed(2)).toBe(4)
    expect(cycleSpeed(4)).toBe(0.25)
  })
})

describe('formatMetrics', () => {
  it('rounds throughput to 1 decimal, ms and percent to integers', () => {
    expect(formatMetrics({ throughput: 2.46, p50: 1199.6, p95: 2700.2, errorRate: 0.314 })).toEqual({
      throughput: '2.5',
      p50: '1200',
      p95: '2700',
      errors: '31',
    })
  })
})
