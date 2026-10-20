import { describe, expect, it } from 'vitest'
import { Scheduler } from '../../src/engine/scheduler'
import { createRandom } from '../../src/engine/random'

describe('Scheduler', () => {
  it('runs actions in time order, FIFO on ties, and actions may schedule more', () => {
    const s = new Scheduler()
    const order: string[] = []
    s.at(100, () => order.push('a'))
    s.at(50, () => {
      order.push('b')
      s.after(10, () => order.push('d'))
    })
    s.at(100, () => order.push('c'))
    s.advance(100)
    expect(order).toEqual(['b', 'd', 'a', 'c'])
    expect(s.now).toBe(100)
  })

  it('does not run actions beyond the advanced window', () => {
    const s = new Scheduler()
    let called = false
    s.at(200, () => {
      called = true
    })
    s.advance(100)
    expect(called).toBe(false)
    expect(s.now).toBe(100)
    s.advance(100)
    expect(called).toBe(true)
  })

  it('cancel prevents execution', () => {
    const s = new Scheduler()
    let called = false
    const id = s.at(10, () => {
      called = true
    })
    s.cancel(id)
    s.advance(50)
    expect(called).toBe(false)
  })

  it('clear drops pending actions', () => {
    const s = new Scheduler()
    let called = false
    s.at(10, () => {
      called = true
    })
    s.clear()
    s.advance(50)
    expect(called).toBe(false)
  })
})

describe('createRandom', () => {
  it('is deterministic per seed', () => {
    const take = (seed: number) => {
      const r = createRandom(seed)
      return Array.from({ length: 5 }, () => r())
    }
    expect(take(42)).toEqual(take(42))
    expect(take(42)).not.toEqual(take(43))
    for (const v of take(1)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
