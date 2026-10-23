import { behaviorField, defineComponent, processingFields, waitingClientsField } from '../engine/registry'
import { activeProgram, forgetSessionsIfDown, handleBehaviorResponse, initialBehaviorState, runBehavior, sweepBehaviorPending, type BehaviorState } from './behavior/run'
import { cacheAside, handleCacheAsideResponse, initialCacheAsideState, sweepCacheAsidePending, type CacheAsideState } from './shared/cacheAside'
import { initialPullState, pollTick, pullUpstreams, type PullState } from './shared/pull'
import { DEFAULT_POLL_INTERVAL } from './worker'
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

export const service = defineComponent<ServiceConfig, DependencyState & BehaviorState & CacheAsideState & PullState>({
  type: 'service',
  label: 'Servicio',
  icon: '⚙️',
  color: 'ok',
  group: 'compute',
  config: {
    ...processingFields,
    queueMax: waitingClientsField,
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
  initialState: () => ({ ...initialDependencyState(), ...initialBehaviorState(), ...initialCacheAsideState(), ...initialPullState() }),
  onMessage(msg, ctx) {
    sweepBehaviorPending(ctx)
    sweepCacheAsidePending(ctx)
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
    ctx.process(msg, () => {
      const done = (ok: boolean) => {
        ctx.reply(msg, ok ? { status: 'ok', code: 200 } : { status: 'error', code: 502 })
        // If this service consumes from a queue/broker, pull the next work right away (no-op otherwise).
        pullUpstreams(ctx)
      }
      // A request with a leaf Cache: cache-aside (cache spec §3); otherwise call every output, as always.
      if (msg.kind !== 'request' || !cacheAside(ctx, msg, ctx.config.mode, done)) callDependencies(ctx, msg, ctx.config.mode, done)
    })
  },
  /** `session memory` forgets its sessions as soon as Activo goes off, even while paused. */
  onConfig(ctx) {
    forgetSessionsIfDown(ctx)
  },
  /** Fails DSL children sent to a deleted node, and polls any upstream queue/broker on the idle interval. */
  onTick(ctx, dtMs) {
    sweepBehaviorPending(ctx)
    sweepCacheAsidePending(ctx)
    forgetSessionsIfDown(ctx)
    pollTick(ctx, dtMs, DEFAULT_POLL_INTERVAL)
  },
  onResponse(res, ctx) {
    if (!handleBehaviorResponse(res, ctx) && !handleCacheAsideResponse(res, ctx) && !handleDependencyResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
