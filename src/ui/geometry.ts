/* Edge geometry ported from the decks' sim.js (`cubic`, `curve`, `edge`). */

export type Point = { x: number; y: number }
/** Center-based box: (x, y) is the center, hw/hh the half width/height. */
export type Box = { x: number; y: number; hw: number; hh: number }

/** Minimal shape of a React Flow InternalNode that boxOf needs. */
export interface MeasuredNode {
  internals: { positionAbsolute: Point }
  measured: { width?: number; height?: number }
}

export function boxOf(n: MeasuredNode): Box {
  const hw = (n.measured.width ?? 0) / 2
  const hh = (n.measured.height ?? 0) / 2
  return { x: n.internals.positionAbsolute.x + hw, y: n.internals.positionAbsolute.y + hh, hw, hh }
}

/** Point on a's border facing b: left/right borders, top/bottom only when b sits straight above/below. */
export function edgePoint(a: Box, b: Box): Point {
  if (Math.abs(b.x - a.x) < 1) return { x: a.x, y: a.y + Math.sign(b.y - a.y) * a.hh }
  return { x: a.x + Math.sign(b.x - a.x) * a.hw, y: a.y }
}

/** Point at t on the horizontal cubic from p0 to p1 (both control points share the mid x). */
export function cubicPoint(p0: Point, p1: Point, t: number): Point {
  const u = 1 - t
  const k0 = u * u * u
  const k1 = 3 * u * u * t
  const k2 = 3 * u * t * t
  const k3 = t * t * t
  const mx = (p0.x + p1.x) / 2
  return { x: k0 * p0.x + (k1 + k2) * mx + k3 * p1.x, y: (k0 + k1) * p0.y + (k2 + k3) * p1.y }
}

/** SVG path of the same curve cubicPoint samples. */
export function curvePath(p0: Point, p1: Point): string {
  const mx = (p0.x + p1.x) / 2
  return `M${p0.x},${p0.y} C${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`
}
