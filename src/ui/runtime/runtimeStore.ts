import { create } from 'zustand'
import type { MetricsSnapshot, NodeId, NodeStats } from '../../engine/types'

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export const DEFAULT_SPEED = 1

export const ZERO_STATS: NodeStats = { inFlight: 0, queued: 0, ok: 0, errors: 0, pending: 0 }
export const ZERO_METRICS: MetricsSnapshot = { throughput: 0, p50: 0, p95: 0, errorRate: 0 }

export interface RuntimeState {
  playing: boolean
  speed: number
  /** Flow-only mode: traffic ignores capacity limits; only a node that is off fails. */
  flowOnly: boolean
  /** Latest counters per node; a node keeps its object identity while its counters don't change. */
  stats: Record<NodeId, NodeStats>
  /** UI copies of the component states the canvas draws (queue/DLQ items, broker lanes). */
  states: Record<NodeId, unknown>
  metrics: MetricsSnapshot
}

// The app starts paused: the user presses Play when they are ready to watch the traffic.
export const useRuntime = create<RuntimeState>(() => ({
  playing: false,
  speed: DEFAULT_SPEED,
  flowOnly: false,
  stats: {},
  states: {},
  metrics: ZERO_METRICS,
}))

/** The next (dir = 1) or previous (dir = -1) speed in SPEEDS, clamped at both ends. */
export function stepSpeed(speed: number, dir: 1 | -1): number {
  const i = SPEEDS.findIndex((s) => s >= speed)
  const cur = i === -1 ? SPEEDS.length - 1 : i
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, cur + dir))]
}
