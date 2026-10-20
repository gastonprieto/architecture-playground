import type { EdgeId, EdgeRule, Message, MessageKind, NodeId } from './types'

export type Field =
  | { type: 'number'; label: string; default: number; min: number; max: number; step?: number; unit?: string }
  | { type: 'boolean'; label: string; default: boolean }
  | { type: 'select'; label: string; default: string; options: { value: string; label: string }[] }
  | { type: 'text'; label: string; default: string }
  | { type: 'mix'; label: string; default: { value: string; weight: number }[] }

export type Tone = 'req' | 'ok' | 'slow' | 'err' | 'hc' | 'redis' | 'db'

export interface OutEdge {
  edgeId: EdgeId
  target: NodeId
  targetType: string
  rule?: EdgeRule
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
  reply(msg: Message, r: { status: 'ok' | 'error'; code: number }): void
  /** Pass a response one hop further back. */
  forwardResponse(res: Message): void
  /** `reason` is a stable English code ('down', 'queue-full', 'no-output'…); the UI translates it. */
  drop(msg: Message, reason: string, code?: number): void
  process(msg: Message, done: () => void): void
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
  actions?: Record<string, { label: string; run(ctx: Ctx<C, S>): void }>
  /** True only for client. */
  recordsMetrics?: boolean
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Injects the universal `name` text field (default = def.label), listed first. */
export function defineComponent<C, S>(def: ComponentDef<C, S>): ComponentDef<C, S> {
  return {
    ...def,
    config: { name: { type: 'text', label: 'Nombre', default: def.label }, ...def.config },
  }
}

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
    Object.entries(def.config).map(([key, f]) => [key, f.type === 'mix' ? f.default.map((o) => ({ ...o })) : f.default]),
  )
}
