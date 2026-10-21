import { behaviorField, defineComponent, processingFields } from '../engine/registry'
import { activeProgram, forgetSessionsIfDown, handleBehaviorResponse, initialBehaviorState, runBehavior, sweepBehaviorPending, type BehaviorState } from './behavior/run'
import {
  callDependencies,
  handleDependencyResponse,
  initialDependencyState,
  type DependencyMode,
  type DependencyState,
} from './shared/dependencies'

export interface ServiceConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  mode: DependencyMode
  /** Behavior DSL; '' (or invalid) keeps the default: call every output. */
  behavior: string
}

export const service = defineComponent<ServiceConfig, DependencyState & BehaviorState>({
  type: 'service',
  label: 'Servicio',
  icon: '⚙️',
  color: 'ok',
  config: {
    ...processingFields,
    mode: {
      type: 'select',
      label: 'Llamadas',
      default: 'parallel',
      options: [
        { value: 'parallel', label: 'Paralelo' },
        { value: 'sequential', label: 'Secuencial' },
      ],
    },
    behavior: behaviorField,
  },
  initialState: () => ({ ...initialDependencyState(), ...initialBehaviorState() }),
  onMessage(msg, ctx) {
    sweepBehaviorPending(ctx)
    const program = activeProgram(ctx)
    if (program) {
      ctx.occupy(msg, (release) => runBehavior(ctx, program, msg, release))
      return
    }
    ctx.process(msg, () =>
      callDependencies(ctx, msg, ctx.config.mode, (ok) =>
        ctx.reply(msg, ok ? { status: 'ok', code: 200 } : { status: 'error', code: 502 }),
      ),
    )
  },
  /** `session memory` forgets its sessions as soon as Activo goes off, even while paused. */
  onConfig(ctx) {
    forgetSessionsIfDown(ctx)
  },
  /** Fails DSL children sent to a node that was deleted, so their run frees its slot. */
  onTick(ctx) {
    sweepBehaviorPending(ctx)
    forgetSessionsIfDown(ctx)
  },
  onResponse(res, ctx) {
    if (!handleBehaviorResponse(res, ctx) && !handleDependencyResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
