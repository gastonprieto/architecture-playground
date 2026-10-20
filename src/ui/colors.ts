import type { Tone } from '../engine/registry'

/** Semantic colors, as in the decks' sim.js. */
export const C = {
  req: '#7dd3fc',
  ok: '#4ade80',
  slow: '#facc15',
  err: '#f87171',
  hc: '#c084fc',
  redis: '#fb7185',
  db: '#2dd4bf',
  text: '#e2e8f0',
  muted: '#94a3b8',
} as const

/** Per-client colors (defined with the Cliente, which offers them as its color options). */
export { CLIENT_COLORS } from '../components/client'

export function toneColor(tone: Tone): string {
  return C[tone]
}
