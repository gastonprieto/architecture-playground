import type { Graph } from '../engine/types'
import { backfillClients } from './clientColor'

type Config = Record<string, unknown>

/** A Reverse Proxy's `authFailRate` (the removed random "Rechazo auth") → `auth: 'credentials'` when > 0 (sessions spec §8). */
function migrateAuthFailRate(config: Config): Config {
  const { authFailRate, ...rest } = config
  return typeof authFailRate === 'number' && authFailRate > 0 ? { ...rest, auth: 'credentials' } : rest
}

/**
 * A Reverse Proxy's `cacheHitRate` → the edge cache (cache-spec §5): > 0 becomes a random cache with
 * that hit rate over every path; otherwise the cache is off (unless one is already set).
 */
function migrateCacheHitRate(config: Config): Config {
  const { cacheHitRate, ...rest } = config
  if (typeof cacheHitRate === 'number' && cacheHitRate > 0) return { ...rest, cache: 'random', hitRate: cacheHitRate, cacheablePaths: [] }
  return 'cache' in rest ? rest : { ...rest, cache: 'off' }
}

/** What `node` needs migrated, or undefined when it is current. */
function migrateConfig(type: string, config: Config): Config | undefined {
  if (type === 'cache') return 'mode' in config ? undefined : { ...config, mode: 'random' }
  if (type !== 'reverse-proxy' || !('authFailRate' in config || 'cacheHitRate' in config)) return undefined
  let next = config
  if ('authFailRate' in next) next = migrateAuthFailRate(next)
  if ('cacheHitRate' in next) next = migrateCacheHitRate(next)
  return next
}

/**
 * Upgrades fields older graphs used, at every graph entry:
 * - Reverse Proxy `authFailRate` → `auth` (sessions spec §8), dropped in every case;
 * - Reverse Proxy `cacheHitRate` → `cache` / `hitRate` / `cacheablePaths` (cache-spec §5), dropped;
 * - a Cache without `mode` → `mode: 'random'`, keeping its `hitRate` (cache-spec §2.2).
 * Pure and idempotent: returns `graph` itself when nothing changed.
 */
export function migrateGraph(graph: Graph): Graph {
  let changed = false
  const nodes = graph.nodes.map((n) => {
    const config = migrateConfig(n.type, n.config)
    if (!config) return n
    changed = true
    return { ...n, config }
  })
  return changed ? { ...graph, nodes } : graph
}

/** Everything a graph needs when it enters the editor (boot, link, import, preset). */
export const prepareGraph = (graph: Graph): Graph => backfillClients(migrateGraph(graph))
