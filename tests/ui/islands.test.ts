// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { ISLANDS_STORAGE_KEY, useIslands } from '../../src/ui/store/islands'
import { clampOffset } from '../../src/ui/useIsland'

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  right: left + width,
  bottom: top + height,
})

describe('clampOffset', () => {
  // A 200×300 island laid out at (12, 72) inside a 1000×700 canvas.
  const bounds = box(0, 0, 1000, 700)
  const atRest = box(12, 72, 200, 300)

  it('keeps a move that stays inside the canvas', () => {
    expect(clampOffset({ x: 300, y: 50 }, { x: 0, y: 0 }, atRest, bounds)).toEqual({ x: 300, y: 50 })
  })

  it('keeps the whole island inside horizontally, with a margin', () => {
    expect(clampOffset({ x: -500, y: 0 }, { x: 0, y: 0 }, atRest, bounds).x).toBe(8 - 12)
    expect(clampOffset({ x: 5000, y: 0 }, { x: 0, y: 0 }, atRest, bounds).x).toBe(1000 - 8 - 200 - 12)
  })

  it('keeps its top inside vertically and lets the rest go below the edge', () => {
    expect(clampOffset({ x: 0, y: -500 }, { x: 0, y: 0 }, atRest, bounds).y).toBe(8 - 72)
    expect(clampOffset({ x: 0, y: 5000 }, { x: 0, y: 0 }, atRest, bounds).y).toBe(700 - 40 - 72)
  })

  it('measures from where the island is drawn now', () => {
    // Already moved by (100, 0): drawn at left 112.
    const moved = box(112, 72, 200, 300)
    expect(clampOffset({ x: 5000, y: 0 }, { x: 100, y: 0 }, moved, bounds).x).toBe(1000 - 8 - 200 - 12)
  })

  it('pins an island wider than the canvas to its left edge', () => {
    expect(clampOffset({ x: 50, y: 0 }, { x: 0, y: 0 }, box(12, 72, 2000, 300), bounds).x).toBe(8 - 12)
  })
})

describe('islands store', () => {
  beforeEach(() => {
    localStorage.clear()
    useIslands.setState({ offsets: {}, front: null })
  })

  it('remembers a position only when asked to persist it', () => {
    useIslands.getState().move('palette', { x: 10, y: 20 })
    expect(useIslands.getState().offsets.palette).toEqual({ x: 10, y: 20 })
    expect(localStorage.getItem(ISLANDS_STORAGE_KEY)).toBeNull()
    useIslands.getState().move('palette', { x: 30, y: 40 }, true)
    expect(JSON.parse(localStorage.getItem(ISLANDS_STORAGE_KEY)!)).toEqual({ palette: { x: 30, y: 40 } })
  })

  it('reset puts an island back and forgets it', () => {
    useIslands.getState().move('guide', { x: 5, y: 5 }, true)
    useIslands.getState().move('inspector', { x: 1, y: 2 }, true)
    useIslands.getState().reset('guide')
    expect(useIslands.getState().offsets.guide).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(ISLANDS_STORAGE_KEY)!)).toEqual({ inspector: { x: 1, y: 2 } })
  })
})
