import { defineComponent, processingFields } from '../engine/registry'
import { callDependencies, handleDependencyResponse, initialDependencyState, type DependencyState } from './shared/dependencies'

export interface WorkerConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  /** Probability (0..1) that a message fails even when its dependencies succeed (poison messages). */
  failRate: number
}

export const worker = defineComponent<WorkerConfig, DependencyState>({
  type: 'worker',
  label: 'Worker',
  icon: '🛠️',
  color: 'ok',
  config: {
    ...processingFields,
    failRate: { type: 'number', label: 'Tasa de fallo', default: 0, min: 0, max: 1, step: 0.05 },
  },
  initialState: initialDependencyState,
  onMessage(msg, ctx) {
    ctx.process(msg, () =>
      callDependencies(ctx, msg, 'parallel', (ok) => {
        const { failRate } = ctx.config
        const success = ok && (failRate <= 0 || ctx.random() >= failRate)
        ctx.reply(msg, success ? { status: 'ok', code: 200 } : { status: 'error', code: 500 })
      }),
    )
  },
  onResponse(res, ctx) {
    if (!handleDependencyResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
