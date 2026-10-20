import { describe, expect, it } from 'vitest'
import { boxOf, curvePath, cubicPoint, edgePoint, type Box } from '../../src/ui/geometry'

describe('geometry', () => {
  it('edgePoint of two boxes at the same y lands on the facing vertical borders', () => {
    const a: Box = { x: 0, y: 50, hw: 40, hh: 20 }
    const b: Box = { x: 300, y: 50, hw: 60, hh: 30 }
    expect(edgePoint(a, b)).toEqual({ x: 40, y: 50 })
    expect(edgePoint(b, a)).toEqual({ x: 240, y: 50 })
  })

  it('edgePoint of vertically stacked boxes uses the top/bottom borders', () => {
    const a: Box = { x: 100, y: 0, hw: 40, hh: 20 }
    const b: Box = { x: 100, y: 200, hw: 40, hh: 25 }
    expect(edgePoint(a, b)).toEqual({ x: 100, y: 20 })
    expect(edgePoint(b, a)).toEqual({ x: 100, y: 175 })
  })

  it('cubicPoint at t=0 and t=1 returns the endpoints', () => {
    const p0 = { x: 10, y: 20 }
    const p1 = { x: 200, y: 120 }
    expect(cubicPoint(p0, p1, 0)).toEqual(p0)
    expect(cubicPoint(p0, p1, 1)).toEqual(p1)
    const mid = cubicPoint(p0, p1, 0.5)
    expect(mid.x).toBeCloseTo(105)
    expect(mid.y).toBeCloseTo(70)
  })

  it('curvePath draws a horizontal cubic with control points at the mid x', () => {
    expect(curvePath({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe('M0,0 C50,0 50,50 100,50')
  })

  it('boxOf centers the box on the measured node', () => {
    const box = boxOf({ internals: { positionAbsolute: { x: 10, y: 20 } }, measured: { width: 100, height: 40 } })
    expect(box).toEqual({ x: 60, y: 40, hw: 50, hh: 20 })
  })
})
