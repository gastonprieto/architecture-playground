import { behaviorField, defineComponent, processingFields } from '../engine/registry'
import { activeProgram, handleBehaviorResponse, initialBehaviorState, runBehavior, type BehaviorState } from './behavior/run'
import { callDependencies, handleDependencyResponse, initialDependencyState, type DependencyState } from './shared/dependencies'

export interface WorkerConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  /** Probability (0..1) that a message fails even when its dependencies succeed (poison messages). */
  failRate: number
  /** Behavior DSL; '' (or invalid) keeps the default. With a valid DSL, failRate is not used. */
  behavior: string
}

export const worker = defineComponent<WorkerConfig, DependencyState & BehaviorState>({
  type: 'worker',
  label: 'Worker',
  icon: '🛠️',
  color: 'ok',
  config: {
    ...processingFields,
    failRate: { type: 'number', label: 'Tasa de fallo', default: 0, min: 0, max: 1, step: 0.05 },
    behavior: behaviorField,
  },
  initialState: () => ({ ...initialDependencyState(), ...initialBehaviorState() }),
  onMessage(msg, ctx) {
    const program = activeProgram(ctx)
    if (program) {
      ctx.occupy(msg, (release) => runBehavior(ctx, program, msg, release))
      return
    }
    ctx.process(msg, () =>
      callDependencies(ctx, msg, 'parallel', (ok) => {
        const { failRate } = ctx.config
        const success = ok && (failRate <= 0 || ctx.random() >= failRate)
        ctx.reply(msg, success ? { status: 'ok', code: 200 } : { status: 'error', code: 500 })
      }),
    )
  },
  onResponse(res, ctx) {
    if (!handleBehaviorResponse(res, ctx) && !handleDependencyResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
