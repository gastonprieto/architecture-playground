import { describe, expect, it } from 'vitest'
import {
  WIRE_BACK_SAG,
  WIRE_MIN_PULL,
  boxOf,
  portPoints,
  wirePath,
  wirePoint,
  type Box,
} from '../../src/ui/geometry'

describe('geometry', () => {
  it('portPoints attach to the source output (right) and target input (left), even for backward wires', () => {
    const a: Box = { x: 300, y: 50, hw: 60, hh: 30 }
    const b: Box = { x: 0, y: 150, hw: 40, hh: 20 }
    expect(portPoints(a, b)).toEqual([{ x: 360, y: 50 }, { x: -40, y: 150 }])
  })

  it('wirePoint starts and ends at the ports and loops out of them on backward wires', () => {
    const p0 = { x: 100, y: 0 }
    const p1 = { x: 0, y: 100 }
    expect(wirePoint(p0, p1, 0)).toEqual(p0)
    expect(wirePoint(p0, p1, 1)).toEqual(p1)
    expect(wirePoint(p0, p1, 0.1).x).toBeGreaterThan(p0.x)
    expect(wirePoint(p0, p1, 0.9).x).toBeLessThan(p1.x)
  })

  it('wirePath pulls forward wires horizontally by half the gap (at least WIRE_MIN_PULL)', () => {
    expect(wirePath({ x: 0, y: 0 }, { x: 300, y: 50 })).toBe('M0,0 C150,0 150,50 300,50')
    expect(wirePath({ x: 0, y: 0 }, { x: 40, y: 50 })).toBe(`M0,0 C${WIRE_MIN_PULL},0 ${40 - WIRE_MIN_PULL},50 40,50`)
  })

  it('a backward wire on the same row dips below both ports instead of running through the nodes', () => {
    const p0 = { x: 500, y: 100 }
    const p1 = { x: 0, y: 100 }
    expect(wirePoint(p0, p1, 0.5).y).toBeGreaterThan(100 + WIRE_BACK_SAG / 2)
  })

  it('boxOf centers the box on the measured node', () => {
    const box = boxOf({ internals: { positionAbsolute: { x: 10, y: 20 } }, measured: { width: 100, height: 40 } })
    expect(box).toEqual({ x: 60, y: 40, hw: 50, hh: 20 })
  })
})
