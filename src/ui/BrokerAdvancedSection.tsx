import { useId } from 'react'
import type { Graph } from '../engine/types'
import { useT } from '../i18n'
import { useRuntime } from './runtime/runtimeStore'
import type { UiState } from './runtime/useSimulation'
import { useEditor } from './store/editor'

/** One output of the broker in the advanced view. Queues are fire-and-forget: no lane, slots or acks. */
export interface BrokerRow {
  target: string
  name: string
  isQueue: boolean
  pending: number
  inFlight: number
  delivered: number
  ok: number
  errors: number
}

/** Build the advanced-view rows for `brokerId`, one per outgoing edge, from its live UI state (pure, testable). */
export function brokerRows(graph: Graph, brokerId: string, ui: UiState | undefined): BrokerRow[] {
  return graph.edges
    .filter((e) => e.source === brokerId)
    .map((e) => {
      const n = graph.nodes.find((x) => x.id === e.target)
      const name = typeof n?.config.name === 'string' && n.config.name.trim() ? n.config.name.trim() : e.target
      const b = ui?.broker
      return {
        target: e.target,
        name,
        isQueue: n?.type === 'queue',
        pending: ui?.lanes?.[e.target]?.total ?? 0,
        inFlight: b?.inFlight[e.target] ?? 0,
        delivered: b?.delivered[e.target] ?? 0,
        ok: b?.acks[e.target]?.ok ?? 0,
        errors: b?.acks[e.target]?.errors ?? 0,
      }
    })
}

/** "Vista avanzada" of a Broker: per subscriber, its pending lane, in-flight events, deliveries and acks. */
export function BrokerAdvancedSection({ brokerId }: { brokerId: string }) {
  const t = useT()
  const titleId = useId()
  const graph = useEditor((s) => s.graph)
  const ui = useRuntime((s) => s.states[brokerId]) as UiState | undefined
  const rows = brokerRows(graph, brokerId, ui)
  return (
    <section className="lb-adv" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="lb-adv-title">
        {t('inspector.lbAdvanced')} <span className="lb-adv-live">{t('inspector.lbLive')}</span>
      </h3>
      {rows.length === 0 && <p className="lb-adv-empty">{t('inspector.brokerNoTargets')}</p>}
      {rows.map((r) => (
        <div className="lb-adv-srv" key={r.target}>
          <div className="lb-adv-head">
            <span className="lb-adv-name">{r.name}</span>
            <span className="lb-adv-count" title={t('inspector.brokerDelivered')}>
              {t('inspector.brokerDeliveredN', { n: r.delivered })}
            </span>
          </div>
          {r.isQueue ? (
            <p className="broker-adv-line">{t('inspector.brokerQueue')}</p>
          ) : (
            <p className="broker-adv-line">
              <span title={t('inspector.brokerPending')}>☰ {r.pending}</span>
              <span title={t('node.inFlight')}>⏳ {r.inFlight}</span>
              <span title={t('inspector.brokerAcks')} className="node-ok">
                ✔ {r.ok}
              </span>
              <span title={t('inspector.brokerNacks')} className={r.errors > 0 ? 'node-err' : undefined}>
                ✖ {r.errors}
              </span>
            </p>
          )}
        </div>
      ))}
    </section>
  )
}
