import { defineComponent, processingFields, type Field } from '../engine/registry'

export interface DatabaseConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
}

/** Same field as processingFields.processingTime, with a faster default (queries are quick). */
const baseTime = processingFields.processingTime
const processingTime: Field = baseTime.type === 'number' ? { ...baseTime, default: 300 } : baseTime

export const database = defineComponent<DatabaseConfig, Record<string, never>>({
  type: 'database',
  label: 'Base de datos',
  icon: '🗄️',
  color: 'db',
  config: { ...processingFields, processingTime },
  initialState: () => ({}),
  onMessage(msg, ctx) {
    ctx.process(msg, () => ctx.reply(msg, { status: 'ok', code: 200 }))
  },
})
