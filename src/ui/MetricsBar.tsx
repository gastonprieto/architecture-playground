import type { MetricsSnapshot } from '../engine/types'
import { useT } from '../i18n'
import { useRuntime } from './runtime/runtimeStore'

export function formatMetrics(m: MetricsSnapshot) {
  return {
    throughput: m.throughput.toFixed(1),
    p50: String(Math.round(m.p50)),
    p95: String(Math.round(m.p95)),
    errors: String(Math.round(m.errorRate * 100)),
  }
}

/** Global rolling metrics of the requests completed at the clients. */
export function MetricsBar() {
  const metrics = useRuntime((s) => s.metrics)
  const t = useT()
  const f = formatMetrics(metrics)
  return (
    <div className="metrics-bar" aria-label={t('metrics.label')}>
      <span>
        {t('metrics.throughput')} <b>{f.throughput}</b> req/s
      </span>
      <span className="sep">·</span>
      <span>
        p50 <b>{f.p50}</b> ms
      </span>
      <span className="sep">·</span>
      <span>
        p95 <b>{f.p95}</b> ms
      </span>
      <span className="sep">·</span>
      <span className={metrics.errorRate > 0 ? 'metrics-err' : undefined}>
        {t('metrics.errors')} <b>{f.errors}</b>%
      </span>
    </div>
  )
}
