import type { MetricsSnapshot } from './types'

/** Width of the rolling window, in sim-ms. */
export const METRICS_WINDOW_MS = 5000

interface Completion {
  at: number
  latency: number
  ok: boolean
}

/** Completed requests over the last METRICS_WINDOW_MS of sim time. */
export class RollingMetrics {
  /** Ordered by `at` (sim time only moves forward). */
  private entries: Completion[] = []

  record(at: number, latency: number, ok: boolean): void {
    this.entries.push({ at, latency, ok })
  }

  /** throughput in completions/s, p50/p95 in ms (nearest-rank), errorRate in 0..1. */
  snapshot(now: number): MetricsSnapshot {
    this.evict(now)
    const n = this.entries.length
    if (n === 0) return { throughput: 0, p50: 0, p95: 0, errorRate: 0 }
    const sorted = this.entries.map((e) => e.latency).sort((a, b) => a - b)
    const errors = this.entries.reduce((k, e) => k + (e.ok ? 0 : 1), 0)
    return {
      throughput: n / (METRICS_WINDOW_MS / 1000),
      p50: nearestRank(sorted, 50),
      p95: nearestRank(sorted, 95),
      errorRate: errors / n,
    }
  }

  /** Drop entries strictly older than the window. */
  private evict(now: number): void {
    let i = 0
    while (i < this.entries.length && now - this.entries[i].at > METRICS_WINDOW_MS) i++
    if (i > 0) this.entries.splice(0, i)
  }
}

function nearestRank(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}
