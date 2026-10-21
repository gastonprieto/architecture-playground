import { describe, expect, it } from 'vitest'
import type { Message } from '../../src/engine/types'
import { UI_CELLS, uiCopy } from '../../src/ui/runtime/useSimulation'
import { formatMetrics } from '../../src/ui/MetricsBar'
import { SPEEDS, stepSpeed } from '../../src/ui/runtime/runtimeStore'

describe('speeds', () => {
  it('SPEEDS', () => expect(SPEEDS).toEqual([0.25, 0.5, 1, 2, 4]))

  it('stepSpeed moves one step and clamps at both ends', () => {
    expect(stepSpeed(1, 1)).toBe(2)
    expect(stepSpeed(1, -1)).toBe(0.5)
    expect(stepSpeed(4, 1)).toBe(4)
    expect(stepSpeed(0.25, -1)).toBe(0.25)
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

describe('uiCopy', () => {
  const msgs = (n: number, p = 'm'): Message[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, kind: 'message' as const, meta: {}, trail: [], createdAt: 0 }))

  it('copies only the first UI_CELLS items of a queue plus the total', () => {
    const items = msgs(100)
    const ui = uiCopy({ items })
    expect(ui.items!.total).toBe(100)
    expect(ui.items!.head.map((m) => m.id)).toEqual(items.slice(0, UI_CELLS).map((m) => m.id))
    items.shift() // the engine mutates in place; the copy must not change
    expect(ui.items!.head[0].id).toBe('m0')
  })

  it('copies only the head of each broker lane plus its length', () => {
    const ui = uiCopy({ lanes: { S1: msgs(500, 'a'), S2: msgs(3, 'b') } })
    expect(ui.lanes!.S1.total).toBe(500)
    expect(ui.lanes!.S1.head).toHaveLength(UI_CELLS)
    expect(ui.lanes!.S2).toEqual({ total: 3, head: msgs(3, 'b') })
  })
})
