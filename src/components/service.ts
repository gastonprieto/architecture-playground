import { defineComponent, processingFields } from '../engine/registry'
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
}

export const service = defineComponent<ServiceConfig, DependencyState>({
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
  },
  initialState: initialDependencyState,
  onMessage(msg, ctx) {
    ctx.process(msg, () =>
      callDependencies(ctx, msg, ctx.config.mode, (ok) =>
        ctx.reply(msg, ok ? { status: 'ok', code: 200 } : { status: 'error', code: 502 }),
      ),
    )
  },
  onResponse(res, ctx) {
    if (!handleDependencyResponse(res, ctx)) ctx.forwardResponse(res)
  },
})
