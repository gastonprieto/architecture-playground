import { behaviorField, defineComponent, processingFields } from '../engine/registry'
import { activeProgram, forgetSessionsIfDown, handleBehaviorResponse, initialBehaviorState, runBehavior, sweepBehaviorPending, type BehaviorState } from './behavior/run'
import { DEFAULT_POLL_INTERVAL } from './worker'
import { initialPullState, pollTick, pullUpstreams, type PullState } from './shared/pull'

export interface SubscriberConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  /** eventType of the event sent to every output after processing; '' emits nothing. */
  emits: string
  /** How often (sim-ms) the subscriber re-polls its broker for events when it got none. */
  pollInterval: number
  /** Behavior DSL; '' (or invalid) keeps the default. A valid DSL replaces `emits` too. */
  behavior: string
}

type SubscriberState = BehaviorState & PullState

export const subscriber = defineComponent<SubscriberConfig, SubscriberState>({
  type: 'subscriber',
  label: 'Suscriptor',
  icon: '🔔',
  color: 'ok',
  group: 'compute',
  config: {
    ...processingFields,
    emits: { type: 'text', label: 'Emite evento', default: '' },
    pollInterval: { type: 'number', label: 'Intervalo de polling', default: DEFAULT_POLL_INTERVAL, min: 100, max: 10_000, step: 100, unit: 'ms' },
    behavior: behaviorField,
  },
  initialState: () => ({ ...initialBehaviorState(), ...initialPullState() }),
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
    ctx.process(msg, () => {
      ctx.reply(msg, { status: 'ok', code: 200 })
      const { emits } = ctx.config
      if (emits) for (const out of ctx.outputs()) ctx.send(out.target, ctx.newMessage('event', { ...msg.meta, eventType: emits }, msg))
      // Slot freed: pull the next event right away, without waiting the poll interval.
      pullUpstreams(ctx)
    })
  },
  /** `session memory` forgets its sessions as soon as Activo goes off, even while paused. */
  onConfig(ctx) {
    forgetSessionsIfDown(ctx)
  },
  /** Fails DSL children sent to a deleted node, and polls for events on the idle interval. */
  onTick(ctx, dtMs) {
    sweepBehaviorPending(ctx)
    forgetSessionsIfDown(ctx)
    pollTick(ctx, dtMs, DEFAULT_POLL_INTERVAL)
  },
  onResponse(res, ctx) {
    if (!handleBehaviorResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
