import type { UiState } from './runtime/useSimulation'

/**
 * The node counters of a cache (cache-spec §2.3): 🔑 stored keys (keys mode only) and the real
 * hit % (HITs / lookups, only after the first lookup). A Cache shows them per its `mode`; a
 * Reverse Proxy only with its edge cache in real keys.
 */
export function cacheCounters(kind: string, config: Record<string, unknown>, ui: UiState | undefined): { keys: string | null; hit: string | null } {
  const keysMode = kind === 'cache' ? config.mode !== 'random' : kind === 'reverse-proxy' && config.cache === 'keys'
  const shows = kind === 'cache' || keysMode
  if (!shows) return { keys: null, hit: null }
  const hits = ui?.cacheHits ?? 0
  const lookups = hits + (ui?.cacheMisses ?? 0)
  return {
    keys: keysMode ? `🔑 ${ui?.cacheKeys ?? 0}` : null,
    hit: lookups > 0 ? `hit ${Math.round((hits / lookups) * 100)}%` : null,
  }
}
