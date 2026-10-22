import { useId } from 'react'
import type { Graph } from '../engine/types'
import { useT } from '../i18n'
import { C } from './colors'
import { ZERO_STATS, useRuntime } from './runtime/runtimeStore'
import type { LbView, UiState } from './runtime/useSimulation'
import { useEditor } from './store/editor'
import { effectiveWeights } from '../engine/weights'

/** One client's slice of a server's traffic. */
export interface ClientSlice {
  key: string
  name: string
  color: string
  n: number
}

/** A server row of the advanced view: its total, its by-client slices and the algorithm's own metric. */
export interface LbRow {
  target: string
  name: string
  total: number
  pct: number
  slices: ClientSlice[]
  /** The cursor (round-robin) points here. */
  isNext: boolean
  /** Per-algorithm chip text (inflight, weight, pin…), or null when the algorithm has none. */
  chip: string | null
  /** The chip warns (e.g. a saturated server under least-connections). */
  chipWarn: boolean
}

export interface LbAdvanced {
  rows: LbRow[]
  total: number
}

const SATURATED = 5

/** Build the advanced-view rows for `lbId` from its live `lb` state and the graph (pure, testable). */
export function lbAdvanced(graph: Graph, lbId: string, lb: LbView, algorithm: string): LbAdvanced {
  const nameOf = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    return typeof n?.config.name === 'string' && n.config.name.trim() ? n.config.name.trim() : id
  }
  // Server order follows the LB's outgoing edges (as the Pesos section does).
  const edges = graph.edges.filter((e) => e.source === lbId)
  const weights = effectiveWeights(edges.map((e) => e.weight))
  const nextTarget = edges[lb.next % Math.max(1, edges.length)]?.target
  const total = edges.reduce((sum, e) => sum + (lb.routed[e.target]?.total ?? 0), 0)

  const rows = edges.map((e, i): LbRow => {
    const routed = lb.routed[e.target]
    const n = routed?.total ?? 0
    const slices: ClientSlice[] = routed
      ? Object.entries(routed.byClient)
          .map(([key, c]) => ({ key, name: c.name, color: c.color || C.req, n: c.n }))
          .sort((a, b) => b.n - a.n)
      : []
    const inflight = lb.inflight[e.target] ?? 0
    let chip: string | null = null
    let chipWarn = false
    switch (algorithm) {
      case 'least-connections':
        chip = `inflight ${inflight}`
        chipWarn = inflight >= SATURATED
        break
      case 'weighted':
        chip = `×${weights[i]}`
        break
      default:
        chip = null
    }
    return {
      target: e.target,
      name: nameOf(e.target),
      total: n,
      pct: total ? Math.round((n / total) * 100) : 0,
      slices,
      isNext: algorithm === 'round-robin' && e.target === nextTarget,
      chip,
      chipWarn,
    }
  })
  return { rows, total }
}

/** The footer summary line, per algorithm. */
export function lbSummary(lb: LbView, adv: LbAdvanced, algorithm: string): string {
  const inflight = adv.rows.map((r) => lb.inflight[r.target] ?? 0)
  switch (algorithm) {
    case 'least-connections': {
      const worst = adv.rows[inflight.indexOf(Math.max(...inflight))]
      return `inflight ${inflight.join(' / ')} · ${worst ? worst.name : '—'}`
    }
    case 'round-robin': {
      const next = adv.rows.find((r) => r.isNext)
      return `next → ${next ? next.name : '—'}`
    }
    case 'weighted':
      return adv.rows.map((r) => `${r.name} ${r.chip}`).join(' · ')
    case 'ip-hash':
      return `${adv.rows.filter((r) => r.total > 0).length} destinos activos`
    default:
      return `${adv.total} req`
  }
}

/** "Vista avanzada": live routing of the active algorithm, per server, split by client. */
export function LbAdvancedSection({ lbId, algorithm }: { lbId: string; algorithm: string }) {
  const t = useT()
  const titleId = useId()
  const graph = useEditor((s) => s.graph)
  const ui = useRuntime((s) => s.states[lbId]) as UiState | undefined
  const stats = useRuntime((s) => s.stats[lbId]) ?? ZERO_STATS
  const lb = ui?.lb

  if (!lb) {
    return (
      <section className="lb-adv" role="group" aria-labelledby={titleId}>
        <h3 id={titleId} className="lb-adv-title">
          {t('inspector.lbAdvanced')} <span className="lb-adv-live">{t('inspector.lbLive')}</span>
        </h3>
        <p className="lb-adv-empty">{t('inspector.lbEmpty')}</p>
      </section>
    )
  }

  const adv = lbAdvanced(graph, lbId, lb, algorithm)
  return (
    <section className="lb-adv" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="lb-adv-title">
        {t('inspector.lbAdvanced')} <span className="lb-adv-live">{t('inspector.lbLive')}</span>
      </h3>
      <p className="lb-adv-algo">
        {algorithm} · {t('inspector.lbRouted', { n: String(adv.total) })}
      </p>
      {adv.rows.length === 0 && <p className="lb-adv-empty">{t('inspector.lbNoTargets')}</p>}
      {adv.rows.map((r) => (
        <div className="lb-adv-srv" key={r.target}>
          <div className="lb-adv-head">
            <span className="lb-adv-name">
              {r.name}
              {r.isNext && <span className="lb-adv-cursor"> ◂ {t('inspector.lbNext')}</span>}
            </span>
            {r.chip && <span className={`lb-adv-chip${r.chipWarn ? ' warn' : ''}`}>{r.chip}</span>}
            <span className="lb-adv-count">{r.total}</span>
          </div>
          <div className="lb-adv-bar">
            {r.slices.map((c) => (
              <span
                key={c.key}
                className="lb-adv-seg"
                style={{ width: `${r.total ? (c.n / r.total) * 100 : 0}%`, background: c.color }}
                title={`${c.name}: ${c.n}`}
              />
            ))}
          </div>
          <div className="lb-adv-pct">{r.pct}%</div>
        </div>
      ))}
      <p className="lb-adv-foot">{lbSummary(lb, adv, algorithm)}</p>
      {stats.errors > 0 && <p className="lb-adv-foot">✖ {stats.errors}</p>}
    </section>
  )
}
