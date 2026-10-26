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

/** `Carga real | Solo flujo` segmented switch: how the simulation treats load, next to the numbers it resets. */
function ModeToggle() {
  const flowOnly = useRuntime((s) => s.flowOnly)
  const t = useT()
  const modes = [
    { on: false, label: t('metrics.full'), title: t('metrics.fullTitle') },
    { on: true, label: t('metrics.flowOnly'), title: t('metrics.flowOnlyTitle') },
  ]
  return (
    <div className="mode-toggle" role="group" aria-label={t('metrics.mode')}>
      {modes.map((m) => (
        <button
          key={String(m.on)}
          type="button"
          className={m.on === flowOnly ? 'active' : undefined}
          aria-pressed={m.on === flowOnly}
          title={m.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => useRuntime.setState({ flowOnly: m.on })}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

/** Global rolling metrics of the requests completed at the clients, after the simulation mode switch. */
export function MetricsBar() {
  const metrics = useRuntime((s) => s.metrics)
  const t = useT()
  const f = formatMetrics(metrics)
  return (
    <div className="metrics-bar" aria-label={t('metrics.label')}>
      <ModeToggle />
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
