import type { Graph, NodeStats } from '../engine/types'
import { useT, type TFn } from '../i18n'
import { BrokerAdvancedSection } from './BrokerAdvancedSection'
import { LbAdvancedSection } from './LbAdvancedSection'
import { ZERO_STATS, useRuntime } from './runtime/runtimeStore'
import type { UiState } from './runtime/useSimulation'
import { cookieCounter } from './sessions'
import { useEditor } from './store/editor'

/** One label/value line of a component's own live state. */
export interface StatusRow {
  key: string
  label: string
  value: string
}

/** Whether a node shows cache counters: a Cache always, a Reverse Proxy with its edge cache on. */
const cacheShown = (kind: string, config: Record<string, unknown>) =>
  kind === 'cache' || (kind === 'reverse-proxy' && (config.cache === 'keys' || config.cache === 'random'))

/**
 * The type-specific rows of the Estado tab, from data the runtime already exposes (pure, testable):
 * cache keys/HITs/MISSes/hit %, sessions and cookies. Queue/DLQ/broker depth goes in the "En cola"
 * tile; the Load Balancer and the Broker draw their own advanced view.
 */
export function statusRows(kind: string, config: Record<string, unknown>, ui: UiState | undefined, t: TFn): StatusRow[] {
  const rows: StatusRow[] = []
  if (cacheShown(kind, config)) {
    const keysMode = kind === 'cache' ? config.mode !== 'random' : config.cache === 'keys'
    const hits = ui?.cacheHits ?? 0
    const misses = ui?.cacheMisses ?? 0
    if (keysMode) rows.push({ key: 'keys', label: t('node.cacheKeys'), value: String(ui?.cacheKeys ?? 0) })
    rows.push({ key: 'hits', label: 'HITs', value: String(hits) })
    rows.push({ key: 'misses', label: 'MISSes', value: String(misses) })
    rows.push({ key: 'hit', label: t('inspector.hitRate'), value: hits + misses > 0 ? `${Math.round((hits / (hits + misses)) * 100)}%` : '—' })
  }
  const cookies = cookieCounter(kind, config, ui)
  if (cookies) rows.push({ key: 'cookies', label: t(kind === 'client' ? 'node.loggedIn' : 'node.sessions'), value: cookies })
  return rows
}

/** One generic counter tile of the Estado tab. */
export interface StatusTile {
  key: keyof NodeStats
  value: number
}

/**
 * The counter tiles a node type shows (pure, testable): only the ones that mean something for it.
 * Client, LB and Reverse Proxy show their pending requests (sent, not answered yet); a queue's and a
 * broker's "En cola" comes from their own buffer/lanes, which the engine's processing does not see.
 */
export function statusTiles(kind: string, stats: NodeStats, ui: UiState | undefined, graph: Graph): StatusTile[] {
  const ok: StatusTile = { key: 'ok', value: stats.ok }
  const errors: StatusTile = { key: 'errors', value: stats.errors }
  switch (kind) {
    case 'client':
    case 'load-balancer':
    case 'reverse-proxy':
      return [{ key: 'pending', value: stats.pending }, ok, errors]
    case 'queue':
    case 'dlq':
      return [{ key: 'queued', value: ui?.items?.total ?? 0 }, ok, errors]
    case 'broker': {
      // Lanes of subscribers that are gone from the graph are skipped, as on the canvas.
      const lanes = Object.entries(ui?.lanes ?? {}).filter(([id]) => graph.nodes.some((n) => n.id === id))
      return [{ key: 'queued', value: lanes.reduce((n, [, cells]) => n + cells.total, 0) }, ok, errors]
    }
    default:
      return [{ key: 'inFlight', value: stats.inFlight }, { key: 'queued', value: stats.queued }, ok, errors]
  }
}

const TILE_ICON: Record<keyof NodeStats, string> = { inFlight: '⏳', queued: '☰', ok: '✔', errors: '✖', pending: '⇄' }

function Tile({ icon, label, value, tone }: { icon: string; label: string; value: number; tone?: 'ok' | 'err' }) {
  return (
    <div className={`status-tile${tone ? ` ${tone}` : ''}`}>
      <span className="status-tile-value">
        <span aria-hidden>{icon}</span> {value}
      </span>
      <span className="status-tile-label">{label}</span>
    </div>
  )
}

/** "Estado" tab of the node inspector: live counters of every node plus its type-specific view. */
export function NodeStatusPanel({ nodeId, kind, config }: { nodeId: string; kind: string; config: Record<string, unknown> }) {
  const t = useT()
  const stats = useRuntime((s) => s.stats[nodeId]) ?? ZERO_STATS
  const ui = useRuntime((s) => s.states[nodeId]) as UiState | undefined
  const playing = useRuntime((s) => s.playing)
  const graph = useEditor((s) => s.graph)
  const rows = statusRows(kind, config, ui, t)
  const tiles = statusTiles(kind, stats, ui, graph)
  const idle = tiles.every((x) => x.value === 0)
  return (
    <div className="status-panel">
      <div className="status-tiles">
        {tiles.map((x) => (
          <Tile
            key={x.key}
            icon={TILE_ICON[x.key]}
            label={t(`node.${x.key}`)}
            value={x.value}
            tone={x.key === 'ok' ? 'ok' : x.key === 'errors' && x.value > 0 ? 'err' : undefined}
          />
        ))}
      </div>
      {/* The LB view has its own empty hint. */}
      {idle && kind !== 'load-balancer' && <p className="status-empty">{t(playing ? 'inspector.statusNoTraffic' : 'inspector.statusPaused')}</p>}
      {rows.length > 0 && (
        <dl className="status-rows">
          {rows.map((r) => (
            <div className="status-row" key={r.key}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {kind === 'broker' && <BrokerAdvancedSection brokerId={nodeId} />}
      {kind === 'load-balancer' && <LbAdvancedSection lbId={nodeId} algorithm={typeof config.algorithm === 'string' ? config.algorithm : 'round-robin'} />}
    </div>
  )
}
