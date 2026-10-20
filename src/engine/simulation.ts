import { Emitter } from './emitter'
import { createRandom } from './random'
import { defaultConfig, type ComponentDef, type Ctx, type OutEdge, type Registry, type Tone } from './registry'
import { Scheduler } from './scheduler'
import type { EdgeId, Graph, GraphEdge, Message, MessageKind, MetricsSnapshot, NodeId, NodeStats } from './types'

/** Sim-ms one hop between two nodes takes. */
export const HOP_MS = 600
/** Messages whose trail would grow past this many nodes are dropped with reason 'loop'. */
export const MAX_TRAIL = 32
/** onTick period in sim-ms. */
export const TICK_MS = 100

export interface SimEvents {
  'message:sent': { msg: Message; from: NodeId; to: NodeId; edgeId: EdgeId | null; duration: number; at: number }
  'message:arrived': { msg: Message; at: NodeId }
  'message:dropped': { msg: Message; at: NodeId; reason: string; code?: number }
  'node:stats': { nodeId: NodeId; stats: NodeStats }
  'node:label': { nodeId: NodeId; text: string; tone: Tone }
  'metrics:tick': MetricsSnapshot
  'sim:reset': Record<string, never>
}

/** Runtime record of a node. `def` is undefined for unknown component types. */
interface NodeRecord {
  id: NodeId
  type: string
  def: ComponentDef | undefined
  config: Record<string, unknown>
  state: unknown
  stats: NodeStats
}

export interface SimulationOptions {
  seed?: number
  /** Component types; the engine never imports src/components itself. */
  registry: Registry
}

export class Simulation {
  private scheduler = new Scheduler()
  private events = new Emitter<SimEvents>()
  private registry: Registry
  private random: () => number
  private nodes = new Map<NodeId, NodeRecord>()
  private edges = new Map<EdgeId, GraphEdge>()
  private edgeList: GraphEdge[] = []
  private msgSeq = 0

  constructor(graph: Graph, opts: SimulationOptions) {
    this.registry = opts.registry
    this.random = createRandom(opts.seed ?? 1)
    this.setGraph(graph)
    this.scheduler.after(TICK_MS, () => this.tick())
  }

  get now(): number {
    return this.scheduler.now
  }

  advance(ms: number): void {
    this.scheduler.advance(ms)
  }

  on<K extends keyof SimEvents>(k: K, fn: (p: SimEvents[K]) => void): () => void {
    return this.events.on(k, fn)
  }

  /**
   * Replace the graph while running. Nodes keeping their id and type keep their state and stats
   * (config is refreshed); other nodes start from initialState. In-flight messages whose target
   * node or edge disappeared are dropped with reason 'removed' when they arrive.
   */
  setGraph(graph: Graph): void {
    const next = new Map<NodeId, NodeRecord>()
    for (const gn of graph.nodes) {
      const def = this.registry.get(gn.type)
      const config = def ? { ...defaultConfig(def), ...gn.config } : { ...gn.config }
      const prev = this.nodes.get(gn.id)
      if (prev && prev.type === gn.type) {
        prev.config = config
        next.set(gn.id, prev)
      } else {
        const state = def ? def.initialState() : {}
        next.set(gn.id, { id: gn.id, type: gn.type, def, config, state, stats: zeroStats() })
      }
    }
    this.nodes = next
    this.edgeList = graph.edges.filter((e) => next.has(e.source) && next.has(e.target))
    this.edges = new Map(this.edgeList.map((e) => [e.id, e]))
  }

  runAction(nodeId: NodeId, action: string): void {
    const rec = this.nodes.get(nodeId)
    rec?.def?.actions?.[action]?.run(this.ctx(rec))
  }

  /** Test helper: deliver `msg` to `nodeId` right now (synchronously). */
  inject(nodeId: NodeId, msg: Message): void {
    const rec = this.nodes.get(nodeId)
    if (!rec) throw new Error(`Unknown node: ${nodeId}`)
    this.deliver(rec, msg)
  }

  nodeStats(id: NodeId): NodeStats {
    const rec = this.nodes.get(id)
    return rec ? { ...rec.stats } : zeroStats()
  }

  nodeState<S>(id: NodeId): S {
    return this.nodes.get(id)?.state as S
  }

  /** Implemented in Task 6. */
  metrics(): MetricsSnapshot {
    return { throughput: 0, p50: 0, p95: 0, errorRate: 0 }
  }

  // ---------------------------------------------------------------- ticking

  private tick(): void {
    this.scheduler.after(TICK_MS, () => this.tick())
    for (const rec of this.nodes.values()) rec.def?.onTick?.(this.ctx(rec), TICK_MS)
  }

  // ---------------------------------------------------------------- delivery

  /** One hop: emit message:sent and schedule arrival HOP_MS later. `msg` already carries its new trail. */
  private transmit(from: NodeId, to: NodeId, msg: Message): void {
    const edgeId = this.edgeBetween(from, to)
    this.events.emit('message:sent', { msg, from, to, edgeId, duration: HOP_MS, at: this.now })
    this.scheduler.after(HOP_MS, () => this.arrive(to, edgeId, msg))
  }

  /** Arrival: re-check that the target node and the edge travelled still exist. */
  private arrive(to: NodeId, edgeId: EdgeId | null, msg: Message): void {
    const rec = this.nodes.get(to)
    if (!rec || (edgeId !== null && !this.edges.has(edgeId))) {
      this.drop(to, msg, 'removed')
      return
    }
    this.deliver(rec, msg)
  }

  private deliver(rec: NodeRecord, msg: Message): void {
    this.events.emit('message:arrived', { msg, at: rec.id })
    const { def } = rec
    if (msg.kind === 'response') {
      if (def?.onResponse) def.onResponse(msg, this.ctx(rec))
      else this.forwardResponse(rec.id, msg)
    } else if (!def) {
      this.drop(rec.id, msg, 'tipo desconocido')
    } else {
      def.onMessage(msg, this.ctx(rec))
    }
  }

  /** Appends `from` to a copy of the trail (so fan-out copies don't share it), or drops on loop. */
  private send(from: NodeId, to: NodeId, msg: Message): void {
    if (msg.trail.length >= MAX_TRAIL) {
      this.drop(from, msg, 'loop')
      return
    }
    this.transmit(from, to, { ...msg, trail: [...msg.trail, from] })
  }

  /** Build the response to `msg` and send it one hop back along its trail. No-op on an empty trail. */
  private respond(from: NodeId, msg: Message, r: { status: 'ok' | 'error'; code: number }): void {
    if (msg.trail.length === 0) return
    const res: Message = {
      id: this.nextId(),
      kind: 'response',
      meta: { ...msg.meta },
      trail: msg.trail.slice(0, -1),
      // Kept from the request so the originator can compute latency = now - createdAt.
      createdAt: msg.createdAt,
      status: r.status,
      code: r.code,
      replyTo: msg.id,
    }
    this.transmit(from, msg.trail[msg.trail.length - 1], res)
  }

  private forwardResponse(from: NodeId, res: Message): void {
    if (res.trail.length === 0) return // reached the originator: the response ends here
    this.transmit(from, res.trail[res.trail.length - 1], { ...res, trail: res.trail.slice(0, -1) })
  }

  /** Emit message:dropped, count an error, and answer requests with an error response. */
  private drop(at: NodeId, msg: Message, reason: string, code?: number): void {
    const effective = msg.kind === 'request' ? (code ?? 503) : code
    this.events.emit('message:dropped', { msg, at, reason, code: effective })
    const rec = this.nodes.get(at)
    if (rec) this.bump(rec, 'errors')
    if (msg.kind === 'request') this.respond(at, msg, { status: 'error', code: effective! })
  }

  /**
   * Seam for Task 5 (capacity slots + internal queue + up/down). For now: wait processingTime, then done.
   */
  private process(rec: NodeRecord, _msg: Message, done: () => void): void {
    const ms = Number(rec.config.processingTime ?? 0)
    this.scheduleFor(rec, ms, done)
  }

  /** Schedule a node-owned callback; skipped if the node was removed or replaced meanwhile. */
  private scheduleFor(rec: NodeRecord, ms: number, fn: () => void): void {
    this.scheduler.after(ms, () => {
      if (this.nodes.get(rec.id) === rec) fn()
    })
  }

  // ---------------------------------------------------------------- helpers

  private edgeBetween(a: NodeId, b: NodeId): EdgeId | null {
    const forward = this.edgeList.find((e) => e.source === a && e.target === b)
    const reverse = forward ?? this.edgeList.find((e) => e.source === b && e.target === a)
    return reverse?.id ?? null
  }

  private bump(rec: NodeRecord, field: keyof NodeStats): void {
    rec.stats[field]++
    this.events.emit('node:stats', { nodeId: rec.id, stats: { ...rec.stats } })
  }

  private nextId(): string {
    return `m${++this.msgSeq}`
  }

  /** A fresh ctx bound to `rec`. `now`, `config` and `state` are live getters. */
  private ctx(rec: NodeRecord): Ctx {
    // oxlint-disable-next-line no-this-alias -- getters below need the instance
    const sim = this
    return {
      nodeId: rec.id,
      get now() {
        return sim.now
      },
      get config() {
        return rec.config
      },
      get state() {
        return rec.state
      },
      outputs: (): OutEdge[] =>
        sim.edgeList
          .filter((e) => e.source === rec.id)
          .map((e) => ({ edgeId: e.id, target: e.target, targetType: sim.nodes.get(e.target)!.type, rule: e.rule })),
      peer: (id) => {
        const p = sim.nodes.get(id)
        return p ? { type: p.type, config: p.config } : undefined
      },
      newMessage: (kind: MessageKind, meta: Message['meta'], parent?: Message): Message => ({
        id: sim.nextId(),
        kind,
        meta: { ...meta },
        trail: [],
        createdAt: sim.now,
        parentId: parent?.id,
      }),
      send: (target, msg) => sim.send(rec.id, target, msg),
      reply: (msg, r) => {
        sim.bump(rec, r.status === 'ok' ? 'ok' : 'errors')
        sim.respond(rec.id, msg, r)
      },
      forwardResponse: (res) => sim.forwardResponse(rec.id, res),
      drop: (msg, reason, code) => sim.drop(rec.id, msg, reason, code),
      process: (msg, done) => sim.process(rec, msg, done),
      schedule: (ms, fn) => sim.scheduleFor(rec, ms, fn),
      label: (text, tone) => sim.events.emit('node:label', { nodeId: rec.id, text, tone }),
      random: () => sim.random(),
    }
  }
}

function zeroStats(): NodeStats {
  return { inFlight: 0, queued: 0, ok: 0, errors: 0 }
}
