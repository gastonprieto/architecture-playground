import { defineComponent } from '../engine/registry'
import type { Message } from '../engine/types'

export interface DlqConfig {
  name: string
}

export interface DlqState {
  /** Dead messages, oldest first. */
  items: Message[]
}

export const dlq = defineComponent<DlqConfig, DlqState>({
  type: 'dlq',
  label: 'DLQ',
  icon: '☠️',
  color: 'err',
  config: {},
  initialState: () => ({ items: [] }),
  // Stores whatever arrives; never replies.
  onMessage(msg, ctx) {
    ctx.state.items.push(msg)
  },
  actions: {
    reprocess: {
      label: 'Reprocesar',
      run(ctx) {
        const items = ctx.state.items
        ctx.state.items = []
        for (const msg of items) {
          // The queue that dead-lettered it is the last hop of its trail.
          const origin = msg.trail.at(-1)
          if (origin !== undefined && ctx.peer(origin)) ctx.send(origin, { ...msg, trail: [], attempt: 0 })
          else ctx.drop(msg, 'sin cola de origen')
        }
      },
    },
  },
})
