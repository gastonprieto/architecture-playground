import { defineComponent, processingFields, type Field } from '../engine/registry'

export interface CacheConfig {
  name: string
  hitRate: number
  processingTime: number
}

export interface CacheState {
  /** Responses that passed back through after a miss (values "stored" in the cache). */
  stored: number
}

/** Same field as processingFields.processingTime, with a fast default (an in-memory lookup). */
const baseTime = processingFields.processingTime
const processingTime: Field = baseTime.type === 'number' ? { ...baseTime, default: 50 } : baseTime

export const cache = defineComponent<CacheConfig, CacheState>({
  type: 'cache',
  label: 'Cache',
  icon: '⚡',
  color: 'redis',
  config: {
    hitRate: { type: 'number', label: 'Hit rate', default: 0.8, min: 0, max: 1, step: 0.05 },
    // Only the lookup time: no capacity/queueMax/up, so the cache never queues or rejects.
    processingTime,
  },
  initialState: () => ({ stored: 0 }),
  onMessage(msg, ctx) {
    ctx.process(msg, () => {
      if (ctx.random() < ctx.config.hitRate) {
        ctx.label('HIT', 'redis')
        ctx.reply(msg, { status: 'ok', code: 200 })
        return
      }
      ctx.label('MISS', 'slow')
      const next = ctx.outputs()[0]
      if (!next) {
        ctx.drop(msg, 'no-output', 503)
        return
      }
      ctx.send(next.target, msg)
    })
  },
  onResponse(res, ctx) {
    ctx.state.stored++
    ctx.forwardResponse(res)
  },
})
