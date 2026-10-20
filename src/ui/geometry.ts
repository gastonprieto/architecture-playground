/* Wire geometry: edges and packets ride the same cubic from an output port to an input port. */

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

/** Minimum horizontal pull of a wire's control points, so backward wires loop around instead of folding. */
export const WIRE_MIN_PULL = 60

/** Where a wire attaches: the source's output port (right middle) and the target's input port (left middle). */
export function portPoints(source: Box, target: Box): [Point, Point] {
  return [
    { x: source.x + source.hw, y: source.y },
    { x: target.x - target.hw, y: target.y },
  ]
}

/** How far a backward wire between nodes on about the same row dips below them, so it doesn't run through them. */
export const WIRE_BACK_SAG = 140
const SAME_ROW = 120

function wireControls(p0: Point, p1: Point): [Point, Point] {
  if (p1.x >= p0.x) {
    const pull = Math.max((p1.x - p0.x) / 2, WIRE_MIN_PULL)
    return [
      { x: p0.x + pull, y: p0.y },
      { x: p1.x - pull, y: p1.y },
    ]
  }
  // Backward: leave the output to the right, come into the input from the left, looping below when on the same row.
  const sag = Math.abs(p1.y - p0.y) < SAME_ROW ? WIRE_BACK_SAG : 0
  return [
    { x: p0.x + WIRE_MIN_PULL * 1.5, y: p0.y + sag },
    { x: p1.x - WIRE_MIN_PULL * 1.5, y: p1.y + sag },
  ]
}

/** Point at t on the wire from an output port p0 to an input port p1. */
export function wirePoint(p0: Point, p1: Point, t: number): Point {
  const [c0, c1] = wireControls(p0, p1)
  const u = 1 - t
  const k0 = u * u * u
  const k1 = 3 * u * u * t
  const k2 = 3 * u * t * t
  const k3 = t * t * t
  return {
    x: k0 * p0.x + k1 * c0.x + k2 * c1.x + k3 * p1.x,
    y: k0 * p0.y + k1 * c0.y + k2 * c1.y + k3 * p1.y,
  }
}

/** SVG path of the same curve wirePoint samples. */
export function wirePath(p0: Point, p1: Point): string {
  const [c0, c1] = wireControls(p0, p1)
  return `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`
}
