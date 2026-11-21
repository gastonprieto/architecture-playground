import { describe, expect, it } from 'vitest'
import { GAP, placeCard, type PlaceInput } from '../../src/ui/tourPlacement'

const viewport = { w: 1280, h: 720 }
const card = { w: 340, h: 200 }
const toolbar = { x: 250, y: 14, w: 780, h: 46 }
const base = { card, viewport, avoid: [toolbar], avoidIfPossible: [] } satisfies Partial<PlaceInput>

describe('placeCard', () => {
  it('uses the preferred side when it fits', () => {
    const palette = { x: 12, y: 72, w: 196, h: 580 }
    const at = placeCard({ ...base, candidates: [{ anchor: palette, side: 'right' }] })
    expect(at).toEqual({ x: 12 + 196 + GAP, y: 72 + 290 - 100 })
  })

  it('never covers the toolbar: below a lit area that fills the window, it goes beside it instead of above', () => {
    // The components' box leaves no room below, and above it is the toolbar.
    const nodes = { x: 508, y: 186, w: 750, h: 410 }
    const at = placeCard({ ...base, candidates: [{ anchor: nodes, side: 'bottom' }] })!
    expect(at.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.h)
    expect(at.x + card.w).toBeLessThanOrEqual(nodes.x)
  })

  it('keeps clear of the lit areas, moving on to the next placement', () => {
    const nodes = { x: 508, y: 186, w: 750, h: 410 }
    const inspector = { x: 982, y: 66, w: 286, h: 390 }
    const at = placeCard({
      ...base,
      avoidIfPossible: [nodes, inspector],
      candidates: [
        { anchor: inspector, side: 'bottom' },
        { anchor: nodes, side: 'bottom' },
      ],
    })!
    const box = { ...at, ...card }
    for (const r of [nodes, inspector]) {
      expect(box.x + box.w <= r.x || box.x >= r.x + r.w || box.y + box.h <= r.y || box.y >= r.y + r.h).toBe(true)
    }
  })

  it('covers a lit area rather than the toolbar when nothing else fits', () => {
    const everything = { x: 0, y: 70, w: 1280, h: 650 }
    const at = placeCard({ ...base, avoidIfPossible: [everything], candidates: [{ anchor: { x: 600, y: 300, w: 80, h: 40 }, side: 'bottom' }] })
    expect(at).toEqual({ x: 470, y: 300 + 40 + GAP })
  })

  it('slides along the edge to stay on screen, and gives up (null) when no side fits', () => {
    const play = { x: 1200, y: 14, w: 70, h: 46 }
    expect(placeCard({ ...base, avoid: [], candidates: [{ anchor: play, side: 'bottom' }] })!.x).toBe(1280 - 340 - 12)
    const huge = { x: 0, y: 0, w: 1280, h: 720 }
    expect(placeCard({ ...base, candidates: [{ anchor: huge, side: 'bottom' }] })).toBeNull()
  })
})
