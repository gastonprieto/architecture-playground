import { behaviorField, defineComponent, processingFields } from '../engine/registry'
import { activeProgram, handleBehaviorResponse, initialBehaviorState, runBehavior, sweepBehaviorPending, type BehaviorState } from './behavior/run'

export interface SubscriberConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  /** eventType of the event sent to every output after processing; '' emits nothing. */
  emits: string
  /** Behavior DSL; '' (or invalid) keeps the default. A valid DSL replaces `emits` too. */
  behavior: string
}

export const subscriber = defineComponent<SubscriberConfig, BehaviorState>({
  type: 'subscriber',
  label: 'Suscriptor',
  icon: '📥',
  color: 'ok',
  config: {
    ...processingFields,
    emits: { type: 'text', label: 'Emite evento', default: '' },
    behavior: behaviorField,
  },
  initialState: initialBehaviorState,
  onMessage(msg, ctx) {
    sweepBehaviorPending(ctx)
    const program = activeProgram(ctx)
    if (program) {
      ctx.occupy(msg, (release) => runBehavior(ctx, program, msg, release))
      return
    }
    ctx.process(msg, () => {
      ctx.reply(msg, { status: 'ok', code: 200 })
      const { emits } = ctx.config
      if (!emits) return
      for (const out of ctx.outputs()) ctx.send(out.target, ctx.newMessage('event', { ...msg.meta, eventType: emits }, msg))
    })
  },
  /** Fails DSL children sent to a node that was deleted, so their run frees its slot. */
  onTick(ctx) {
    sweepBehaviorPending(ctx)
  },
  onResponse(res, ctx) {
    if (!handleBehaviorResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
