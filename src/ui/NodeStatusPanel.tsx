import type { Graph, NodeStats } from '../engine/types'
import { useT, type TFn } from '../i18n'
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

const nameIn = (graph: Graph, id: string) => {
  const n = graph.nodes.find((x) => x.id === id)
  return typeof n?.config.name === 'string' && n.config.name.trim() ? n.config.name.trim() : id
}

/** Whether a node shows cache counters: a Cache always, a Reverse Proxy with its edge cache on. */
const cacheShown = (kind: string, config: Record<string, unknown>) =>
  kind === 'cache' || (kind === 'reverse-proxy' && (config.cache === 'keys' || config.cache === 'random'))

/**
 * The type-specific rows of the Estado tab, from data the runtime already exposes (pure, testable):
 * queue/DLQ depth, broker depth per subscriber, cache keys/HITs/MISSes/hit %, sessions and cookies.
 * The Load Balancer draws its own advanced view instead.
 */
export function statusRows(kind: string, config: Record<string, unknown>, ui: UiState | undefined, graph: Graph, t: TFn): StatusRow[] {
  const rows: StatusRow[] = []
  if (kind === 'queue' || kind === 'dlq') rows.push({ key: 'depth', label: t('inspector.depth'), value: String(ui?.items?.total ?? 0) })
  if (kind === 'broker') {
    // Lanes of subscribers that are gone from the graph are skipped, as on the canvas.
    for (const [id, cells] of Object.entries(ui?.lanes ?? {})) {
      if (!graph.nodes.some((n) => n.id === id)) continue
      rows.push({ key: `lane:${id}`, label: t('inspector.laneDepth', { name: nameIn(graph, id) }), value: String(cells.total) })
    }
    if (rows.length === 0) rows.push({ key: 'lanes', label: t('inspector.depth'), value: '0' })
  }
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

/** Whether a node has seen no traffic yet (all its counters at zero). */
export const isIdle = (s: NodeStats) => s.inFlight + s.queued + s.ok + s.errors === 0

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
  const graph = useEditor((s) => s.graph)
  const rows = statusRows(kind, config, ui, graph, t)
  return (
    <div className="status-panel">
      <div className="status-tiles">
        <Tile icon="⏳" label={t('node.inFlight')} value={stats.inFlight} />
        <Tile icon="☰" label={t('node.queued')} value={stats.queued} />
        <Tile icon="✔" label={t('node.ok')} value={stats.ok} tone="ok" />
        <Tile icon="✖" label={t('node.errors')} value={stats.errors} tone={stats.errors > 0 ? 'err' : undefined} />
      </div>
      {/* The LB view has its own empty hint. */}
      {isIdle(stats) && kind !== 'load-balancer' && <p className="status-empty">{t('inspector.statusEmpty')}</p>}
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
      {kind === 'load-balancer' && <LbAdvancedSection lbId={nodeId} algorithm={typeof config.algorithm === 'string' ? config.algorithm : 'round-robin'} />}
    </div>
  )
}
