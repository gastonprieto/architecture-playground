import type { EdgeId, EdgeRule, Message, MessageKind, NodeId } from './types'

/** Show a field only while another field of the same config has this value (the UI hides it otherwise). */
export interface FieldCondition {
  field: string
  equals: string | boolean | number
}

type FieldKind =
  | { type: 'number'; label: string; default: number; min: number; max: number; step?: number; unit?: string }
  | { type: 'boolean'; label: string; default: boolean }
  | { type: 'select'; label: string; default: string; options: { value: string; label: string }[] }
  | { type: 'text'; label: string; default: string }
  | { type: 'mix'; label: string; default: { value: string; weight: number }[] }
  /** One of a fixed set of `#rrggbb` colors (the inspector shows swatches). */
  | { type: 'color'; label: string; default: string; options: readonly string[] }
  /** Behavior DSL text (src/components/behavior); '' keeps the component's default behavior. */
  | { type: 'behavior'; label: string; default: '' }
  /** An ordered list of strings (e.g. path prefixes). */
  | { type: 'list'; label: string; default: string[] }

export type Field = FieldKind & { showIf?: FieldCondition }

/**
 * Whether `field` applies under `config` (its `showIf` holds). A missing controlling value falls back
 * to that field's default in `def`, if given. Engine and UI share this rule.
 */
export function fieldVisible(field: Field, config: Record<string, unknown>, def?: ComponentDef): boolean {
  const cond = field.showIf
  if (!cond) return true
  const value = cond.field in config ? config[cond.field] : def?.config[cond.field]?.default
  return value === cond.equals
}

export type Tone = 'req' | 'ok' | 'slow' | 'err' | 'hc' | 'redis' | 'db'

export interface ReplyInfo {
  status: 'ok' | 'error'
  code: number
  /**
   * Patch merged over the request's meta on the response; its keys override the request's. Use it
   * only for reply data (`setSession`, `authError`, ...): never change identity keys (`clientId`,
   * `clientIp`, `userIndex`, `sessionId`, ...), which the originator and the hops back rely on.
   */
  meta?: Partial<Message['meta']>
}

export interface OutEdge {
  edgeId: EdgeId
  target: NodeId
  targetType: string
  rule?: EdgeRule
  /** The connection's weight, if set (see engine/weights). */
  weight?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Ctx<C = any, S = any> {
  nodeId: NodeId
  now: number
  config: C
  state: S
  outputs(): OutEdge[]
  peer(id: NodeId): { type: string; config: Record<string, unknown> } | undefined
  /** Fresh id, empty trail, createdAt = now, parentId = parent?.id. */
  newMessage(kind: MessageKind, meta: Message['meta'], parent?: Message): Message
  /** Appends this node to msg.trail. */
  send(target: NodeId, msg: Message): void
  /** Answer `msg` one hop back. `meta` is merged over the request's meta on the response. */
  reply(msg: Message, r: ReplyInfo): void
  /** Pass a response one hop further back. */
  forwardResponse(res: Message): void
  /** `reason` is a stable English code ('down', 'queue-full', 'no-output'…); the UI translates it. */
  drop(msg: Message, reason: string, code?: number): void
  process(msg: Message, done: () => void): void
  /**
   * Like `process`, but the slot stays in use after `processingTime` until `release()` is called
   * (idempotent; harmless after the node is removed).
   */
  occupy(msg: Message, run: (release: () => void) => void): void
  schedule(ms: number, fn: () => void): void
  /** `text` is a code too ('retry', 'no-subscribers') or a literal token ('HIT', '202'). */
  label(text: string, tone: Tone): void
  random(): number
}

export interface ComponentDef<C = any, S = any> {
  type: string
  label: string
  icon: string
  color: Tone
  config: Record<string, Field>
  initialState(): S
  onMessage(msg: Message, ctx: Ctx<C, S>): void
  onResponse?(res: Message, ctx: Ctx<C, S>): void
  onTick?(ctx: Ctx<C, S>, dtMs: number): void
  /**
   * Called synchronously on every setGraph that keeps this node (same id and type), after its config
   * was refreshed; `prev` is the config it had before. Runs even while paused (no time passes), and
   * on every graph edit, including ones that change nothing of this node (e.g. moving any node), so
   * it must be idempotent.
   */
  onConfig?(ctx: Ctx<C, S>, prev: C): void
  /** Icon derived from the config (e.g. the database kind); `icon` is the base one the palette uses. */
  iconFor?(config: C): string
  actions?: Record<string, { label: string; run(ctx: Ctx<C, S>): void }>
  /** True only for client. */
  recordsMetrics?: boolean
  /** False for source-only components (Cliente): no input port, nothing can be wired into them. Default true. */
  inputs?: boolean
  /**
   * The config the engine's processing (up / processingTime / capacity / queueMax) reads, when it
   * differs from the component's config: e.g. the Cache's `capacity` counts keys, not slots.
   */
  processingConfig?(config: C): Record<string, unknown>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Injects the universal `name` text field (default = def.label), listed first. */
export function defineComponent<C, S>(def: ComponentDef<C, S>): ComponentDef<C, S> {
  return {
    ...def,
    config: { name: { type: 'text', label: 'Nombre', default: def.label }, ...def.config },
  }
}

/** The `behavior` config field of Servicio, Worker and Suscriptor. */
export const behaviorField: Field = { type: 'behavior', label: 'Comportamiento', default: '' }

export const processingFields: Record<'up' | 'processingTime' | 'capacity' | 'queueMax', Field> = {
  up: { type: 'boolean', label: 'Activo', default: true },
  processingTime: { type: 'number', label: 'Tiempo de proceso', default: 400, min: 50, max: 5000, step: 50, unit: 'ms' },
  capacity: { type: 'number', label: 'Capacidad', default: 2, min: 1, max: 50 },
  queueMax: { type: 'number', label: 'Cola máx.', default: 10, min: 0, max: 500 },
}

export class Registry {
  private defs = new Map<string, ComponentDef>()

  register(def: ComponentDef): void {
    if (this.defs.has(def.type)) throw new Error(`Component type already registered: ${def.type}`)
    this.defs.set(def.type, def)
  }

  get(type: string): ComponentDef | undefined {
    return this.defs.get(type)
  }

  list(): ComponentDef[] {
    return [...this.defs.values()]
  }
}

export function defaultConfig(def: ComponentDef): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(def.config).map(([key, f]) => [
      key,
      f.type === 'mix' ? f.default.map((o) => ({ ...o })) : f.type === 'list' ? [...f.default] : f.default,
    ]),
  )
}
