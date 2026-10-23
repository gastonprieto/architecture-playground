import type { UiState } from './runtime/useSimulation'

/**
 * The node counters of a Cache (cache-spec §2.3): 🔑 stored keys (keys mode only) and the real hit %
 * (HITs / lookups, only after the first lookup). A Reverse Proxy shows its edge cache only in the
 * inspector, to keep its node small.
 */
export function cacheCounters(kind: string, config: Record<string, unknown>, ui: UiState | undefined): { keys: string | null; hit: string | null } {
  if (kind !== 'cache') return { keys: null, hit: null }
  const hits = ui?.cacheHits ?? 0
  const lookups = hits + (ui?.cacheMisses ?? 0)
  return {
    keys: config.mode !== 'random' ? `🔑 ${ui?.cacheKeys ?? 0}` : null,
    hit: lookups > 0 ? `hit ${Math.round((hits / lookups) * 100)}%` : null,
  }
}
