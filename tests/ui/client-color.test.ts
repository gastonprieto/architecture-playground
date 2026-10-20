import { describe, expect, it } from 'vitest'
import type { Graph, GraphNode } from '../../src/engine/types'
import { nextClientColor } from '../../src/ui/clientColor'
import { C, CLIENT_COLORS } from '../../src/ui/colors'

const n = (id: string, type: string, config: Record<string, unknown> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, config })
const g = (...nodes: GraphNode[]): Graph => ({ nodes, edges: [] })

/** CIE76 ΔE and hue (degrees) of a #rrggbb color. */
function lab(hex: string): [number, number, number] {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92))
  const [r, gr, b] = lin
  const xyz = [(r * 0.4124 + gr * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + gr * 0.7152 + b * 0.0722, (r * 0.0193 + gr * 0.1192 + b * 0.9505) / 1.08883]
  const [x, y, z] = xyz.map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116))
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a: string, b: string) => {
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}
function hue(hex: string): number {
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, gr, b)
  const d = max - Math.min(r, gr, b)
  if (d === 0) return 0
  const h = max === r ? ((gr - b) / d) % 6 : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4
  return (h * 60 + 360) % 360
}

describe('client colors', () => {
  it('the check flags the swapped-out deck colors', () => {
    for (const c of ['#a3e635', '#2dd4bf']) {
      const dh = Math.abs(hue(c) - hue(C.ok))
      expect(Math.min(dh, 360 - dh) < 60 && deltaE(c, C.ok) < 50, c).toBe(true)
    }
  })

  it('the palette has 6 distinct colors, none of them ok-green or error-red', () => {
    expect(CLIENT_COLORS).toHaveLength(6)
    expect(new Set(CLIENT_COLORS).size).toBe(6)
    for (const c of CLIENT_COLORS) {
      expect(deltaE(c, C.ok), `${c} vs ok`).toBeGreaterThan(35)
      expect(deltaE(c, C.err), `${c} vs err`).toBeGreaterThan(35)
      // Nothing in the green family: a hue within 60° of the ok green that is also fairly close to it
      // (this rules out the decks' lime #a3e635 and teal #2dd4bf; sky blue is far enough).
      const dh = Math.abs(hue(c) - hue(C.ok))
      const greenish = Math.min(dh, 360 - dh) < 60 && deltaE(c, C.ok) < 50
      expect(greenish, `${c} is green-like`).toBe(false)
    }
  })

  it('nextClientColor takes the first palette color no Cliente uses, then cycles', () => {
    expect(nextClientColor(g())).toBe(CLIENT_COLORS[0])
    expect(nextClientColor(g(n('a', 'client', { color: CLIENT_COLORS[0] }), n('s', 'service', { color: CLIENT_COLORS[1] })))).toBe(CLIENT_COLORS[1])
    expect(nextClientColor(g(n('a', 'client', { color: CLIENT_COLORS[1] })))).toBe(CLIENT_COLORS[0])
    const all = CLIENT_COLORS.map((c, i) => n(`c${i}`, 'client', { color: c }))
    expect(nextClientColor(g(...all))).toBe(CLIENT_COLORS[0])
    expect(nextClientColor(g(...all, n('x', 'client', { color: CLIENT_COLORS[0] })))).toBe(CLIENT_COLORS[1])
  })
})
