import { behaviorField, defineComponent, processingFields } from '../engine/registry'
import { activeProgram, forgetSessionsIfDown, handleBehaviorResponse, initialBehaviorState, runBehavior, sweepBehaviorPending, type BehaviorState } from './behavior/run'
import { callDependencies, handleDependencyResponse, initialDependencyState, type DependencyState } from './shared/dependencies'
import { initialPullState, pollTick, pullUpstreams, type PullState } from './shared/pull'

/** Default idle polling interval when the worker leaves `pollInterval` at 0 / unset. */
export const DEFAULT_POLL_INTERVAL = 1000

export interface WorkerConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  /** Probability (0..1) that a message fails even when its dependencies succeed (poison messages). */
  failRate: number
  /** How often (sim-ms) the worker re-polls its queue/broker for work when it got none. */
  pollInterval: number
  /** Behavior DSL; '' (or invalid) keeps the default. With a valid DSL, failRate is not used. */
  behavior: string
}

type WorkerState = DependencyState & BehaviorState & PullState

export const worker = defineComponent<WorkerConfig, WorkerState>({
  type: 'worker',
  label: 'Worker',
  icon: '🛠️',
  color: 'ok',
  config: {
    ...processingFields,
    failRate: { type: 'number', label: 'Tasa de fallo', default: 0, min: 0, max: 1, step: 0.05 },
    pollInterval: { type: 'number', label: 'Intervalo de polling', default: DEFAULT_POLL_INTERVAL, min: 100, max: 10_000, step: 100, unit: 'ms' },
    behavior: behaviorField,
  },
  initialState: () => ({ ...initialDependencyState(), ...initialBehaviorState(), ...initialPullState() }),
  onMessage(msg, ctx) {
    sweepBehaviorPending(ctx)
    const program = activeProgram(ctx)
    if (program) {
      ctx.occupy(msg, (release) =>
        runBehavior(ctx, program, msg, () => {
          release()
          pullUpstreams(ctx)
        }),
      )
      return
    }
    ctx.process(msg, () =>
      callDependencies(ctx, msg, 'parallel', (ok) => {
        const { failRate } = ctx.config
        const success = ok && (failRate <= 0 || ctx.random() >= failRate)
        ctx.reply(msg, success ? { status: 'ok', code: 200 } : { status: 'error', code: 500 })
        // Slot freed: pull the next piece of work right away, without waiting the poll interval.
        pullUpstreams(ctx)
      }),
    )
  },
  /** `session memory` forgets its sessions as soon as Activo goes off, even while paused. */
  onConfig(ctx) {
    forgetSessionsIfDown(ctx)
  },
  /** Fails DSL children sent to a deleted node, and polls for work on the idle interval. */
  onTick(ctx, dtMs) {
    sweepBehaviorPending(ctx)
    forgetSessionsIfDown(ctx)
    pollTick(ctx, dtMs, DEFAULT_POLL_INTERVAL)
  },
  onResponse(res, ctx) {
    if (!handleBehaviorResponse(res, ctx) && !handleDependencyResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
