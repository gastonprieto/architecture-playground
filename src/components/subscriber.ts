import { defineComponent, processingFields } from '../engine/registry'

export interface SubscriberConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  /** eventType of the event sent to every output after processing; '' emits nothing. */
  emits: string
}

export const subscriber = defineComponent<SubscriberConfig, Record<string, never>>({
  type: 'subscriber',
  label: 'Suscriptor',
  icon: '📥',
  color: 'ok',
  config: {
    ...processingFields,
    emits: { type: 'text', label: 'Emite evento', default: '' },
  },
  initialState: () => ({}),
  onMessage(msg, ctx) {
    ctx.process(msg, () => {
      ctx.reply(msg, { status: 'ok', code: 200 })
      const { emits } = ctx.config
      if (!emits) return
      for (const out of ctx.outputs()) ctx.send(out.target, ctx.newMessage('event', { ...msg.meta, eventType: emits }, msg))
    })
  },
})
