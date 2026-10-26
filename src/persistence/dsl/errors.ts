export const GRAPH_DSL_ERROR_CODES = [
  'tab',
  'bad-indent',
  'unknown-type',
  'unknown-key',
  'bad-value',
  'out-of-range',
  'unknown-ref',
  'ambiguous-ref',
  'duplicate-alias',
  'duplicate-edge',
  'duplicate-rule',
  'duplicate-key',
  'multi-alias',
  'missing-colon',
  'missing-name',
  'bad-attribute',
  'unknown-version',
] as const

export type GraphDslErrorCode = (typeof GRAPH_DSL_ERROR_CODES)[number]

/** A problem found while parsing graph text. `params.suggestion` is set when there is a "did you mean…?". */
export interface GraphDslError {
  line: number
  code: GraphDslErrorCode
  params?: Record<string, string | number>
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

/** The closest candidate within Levenshtein distance 2 (ties: first in iteration order). */
export function suggest(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestDistance = 3
  for (const candidate of candidates) {
    const d = distance(word, candidate)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  return best
}
