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

/** Per-client colors, as in the decks' sim.js. */
export const CLIENT_COLORS = ['#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#a78bfa', '#2dd4bf'] as const

export function toneColor(tone: Tone): string {
  return C[tone]
}
