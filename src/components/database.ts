import { defineComponent, processingFields, type Ctx, type Field } from '../engine/registry'

export type DbKind = 'relational' | 'key-value' | 'document'

export interface DatabaseConfig {
  name: string
  kind: DbKind
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
}

export interface DatabaseState {
  /** Stored session ids (`sid:<id>`), in creation order, without duplicates. */
  sessions: string[]
  /** `up` as last seen, to detect an off→on restart; undefined before the first look. */
  lastUp?: boolean
}

/** Suggested processingTime and node icon per kind. Key-value is also volatile (see syncUp). */
export const DB_KIND_DEFAULTS: Record<DbKind, { processingTime: number; icon: string }> = {
  relational: { processingTime: 300, icon: '🗄️' },
  'key-value': { processingTime: 20, icon: '🗝️' },
  document: { processingTime: 80, icon: '📄' },
}

/** The configured kind; graphs saved before the field existed behave as relational. */
export function dbKind(config: Partial<Pick<DatabaseConfig, 'kind'>>): DbKind {
  const k = config.kind
  return k !== undefined && Object.hasOwn(DB_KIND_DEFAULTS, k) ? k : 'relational'
}

/** Same field as processingFields.processingTime, with a faster default (queries are quick). */
const baseTime = processingFields.processingTime
const processingTime: Field = baseTime.type === 'number' ? { ...baseTime, default: DB_KIND_DEFAULTS.relational.processingTime } : baseTime

/**
 * Track `up` and, on an off→on transition of a key-value database, forget every session (it lives in
 * memory). Called from onConfig (every config change, even paused), onTick, onMessage and onResponse.
 */
function syncUp(ctx: Ctx<DatabaseConfig, DatabaseState>): void {
  const up = ctx.config.up !== false
  if (ctx.state.lastUp === false && up && dbKind(ctx.config) === 'key-value') ctx.state.sessions = []
  ctx.state.lastUp = up
}

export const database = defineComponent<DatabaseConfig, DatabaseState>({
  type: 'database',
  label: 'Base de datos',
  icon: DB_KIND_DEFAULTS.relational.icon,
  color: 'db',
  config: {
    kind: {
      type: 'select',
      label: 'Tipo',
      default: 'relational',
      options: [
        { value: 'relational', label: 'Relacional' },
        { value: 'key-value', label: 'Clave-valor' },
        { value: 'document', label: 'Documental' },
      ],
    },
    ...processingFields,
    processingTime,
  },
  iconFor: (config) => DB_KIND_DEFAULTS[dbKind(config)].icon,
  initialState: () => ({ sessions: [] }),
  onConfig(ctx, prev) {
    // See the previous `up` first, so an off→on pair of config changes is caught even with no tick.
    if (ctx.state.lastUp === undefined) ctx.state.lastUp = prev.up !== false
    syncUp(ctx)
  },
  onTick(ctx) {
    syncUp(ctx)
  },
  onResponse(res, ctx) {
    syncUp(ctx)
    ctx.forwardResponse(res)
  },
  onMessage(msg, ctx) {
    syncUp(ctx)
    const op = msg.meta.sessionOp
    const id = msg.meta.sessionId
    if (op !== 'check' && op !== 'create') {
      ctx.process(msg, () => ctx.reply(msg, { status: 'ok', code: 200 }))
      return
    }
    ctx.process(msg, () => {
      const st = ctx.state
      if (op === 'create') {
        if (typeof id === 'string' && !st.sessions.includes(id)) st.sessions.push(id)
        ctx.reply(msg, { status: 'ok', code: 200 })
      } else if (typeof id === 'string' && st.sessions.includes(id)) {
        ctx.reply(msg, { status: 'ok', code: 200 })
      } else {
        ctx.reply(msg, { status: 'error', code: 404 })
      }
    })
  },
})
