/** Weight of a connection with none set: every connection counts the same. */
export const DEFAULT_WEIGHT = 1

/**
 * The weights the weighted load balancer actually uses: a missing or invalid weight counts as
 * DEFAULT_WEIGHT, and when every weight is 0 they all count the same (equal split).
 */
export function effectiveWeights(weights: readonly (number | undefined)[]): number[] {
  const w = weights.map((x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : DEFAULT_WEIGHT))
  return w.length > 0 && w.every((x) => x === 0) ? w.map(() => DEFAULT_WEIGHT) : w
}

/** Each connection's share of the traffic, as a rounded percentage (e.g. [3, 1] → [75, 25]). */
export function sharePercents(weights: readonly (number | undefined)[]): number[] {
  const w = effectiveWeights(weights)
  const total = w.reduce((a, b) => a + b, 0)
  return w.map((x) => (total > 0 ? Math.round((x / total) * 100) : 0))
}
