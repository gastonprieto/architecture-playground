/** A box in viewport pixels. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Side = 'top' | 'bottom' | 'left' | 'right'

/** One way to place the card: next to `anchor`, on `side` (tried in order of preference). */
export interface Candidate {
  anchor: Rect
  side: Side
}

export interface PlaceInput {
  /** Preferred placements, best first; every other side of each anchor is tried after them. */
  candidates: readonly Candidate[]
  card: { w: number; h: number }
  viewport: { w: number; h: number }
  /** Never covered (the toolbar). */
  avoid: readonly Rect[]
  /** Not covered when possible (what the step lights up); dropped when nothing fits otherwise. */
  avoidIfPossible: readonly Rect[]
}

/** Room between the card and its anchor, and between the card and the window edge. */
export const GAP = 14
export const MARGIN = 12

const SIDES: readonly Side[] = ['bottom', 'top', 'right', 'left']

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The card's box on `side` of `a`, centered on it and slid along that edge to stay on screen. */
function boxAt(a: Rect, side: Side, card: PlaceInput['card'], vp: PlaceInput['viewport']): Rect {
  const { w, h } = card
  const cx = clamp(a.x + a.w / 2 - w / 2, MARGIN, vp.w - w - MARGIN)
  const cy = clamp(a.y + a.h / 2 - h / 2, MARGIN, vp.h - h - MARGIN)
  switch (side) {
    case 'bottom':
      return { x: cx, y: a.y + a.h + GAP, w, h }
    case 'top':
      return { x: cx, y: a.y - GAP - h, w, h }
    case 'right':
      return { x: a.x + a.w + GAP, y: cy, w, h }
    case 'left':
      return { x: a.x - GAP - w, y: cy, w, h }
  }
}

const onScreen = (r: Rect, vp: PlaceInput['viewport']) =>
  r.x >= MARGIN && r.y >= MARGIN && r.x + r.w <= vp.w - MARGIN && r.y + r.h <= vp.h - MARGIN

/**
 * Where the tutorial card goes: the first placement that is fully on screen and covers neither the
 * toolbar nor the lit areas; failing that, one that only keeps clear of the toolbar. Null when
 * nothing fits (the card is then centered in the window).
 */
export function placeCard({ candidates, card, viewport, avoid, avoidIfPossible }: PlaceInput): { x: number; y: number } | null {
  const tries = candidates.flatMap((c) => [c.side, ...SIDES.filter((s) => s !== c.side)].map((side) => ({ anchor: c.anchor, side })))
  for (const blocked of [[...avoid, ...avoidIfPossible], avoid]) {
    for (const { anchor, side } of tries) {
      const box = boxAt(anchor, side, card, viewport)
      if (onScreen(box, viewport) && !blocked.some((b) => overlaps(box, b))) return { x: Math.round(box.x), y: Math.round(box.y) }
    }
  }
  return null
}
