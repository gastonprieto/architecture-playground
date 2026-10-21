import { Emitter } from './emitter'
import { createRandom } from './random'
import { RollingMetrics } from './metrics'
import { Processor } from './processing'
import { defaultConfig, type ComponentDef, type Ctx, type OutEdge, type Registry, type ReplyInfo, type Tone } from './registry'
import { Scheduler } from './scheduler'
import type { EdgeId, Graph, GraphEdge, Message, MessageKind, MetricsSnapshot, NodeId, NodeStats } from './types'

/** Sim-ms one hop between two nodes takes. */
export const HOP_MS = 600
/** Messages whose depth + trail would grow past this many nodes are dropped with reason 'loop'. */
export const MAX_TRAIL = 32
/** onTick period in sim-ms. */
export const TICK_MS = 100
/** metrics:tick period in sim-ms. */
export const METRICS_TICK_MS = 500

export interface SimEvents {
  'message:sent': { msg: Message; from: NodeId; to: NodeId; edgeId: EdgeId | null; duration: number; at: number }
  'message:arrived': { msg: Message; at: NodeId }
  'message:dropped': { msg: Message; at: NodeId; reason: string; code?: number }
  'node:stats': { nodeId: NodeId; stats: NodeStats }
  'node:label': { nodeId: NodeId; text: string; tone: Tone }
  'metrics:tick': MetricsSnapshot
}

/** Runtime record of a node. `def` is undefined for unknown component types. */
interface NodeRecord {
  id: NodeId
  type: string
  def: ComponentDef | undefined
  config: Record<string, unknown>
  state: unknown
  stats: NodeStats
  /** Capacity slots, internal queue and up/down for ctx.process. */
  processor: Processor
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
  private rolling = new RollingMetrics()

  constructor(graph: Graph, opts: SimulationOptions) {
    this.registry = opts.registry
    this.random = createRandom(opts.seed ?? 1)
    this.setGraph(graph)
    this.scheduler.after(TICK_MS, () => this.tick())
    this.scheduler.after(METRICS_TICK_MS, () => this.metricsTick())
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
   * (config is refreshed and `onConfig` is called); other nodes start from initialState. In-flight messages whose target
   * node or edge disappeared are dropped with reason 'removed' when they arrive.
   */
  setGraph(graph: Graph): void {
    const next = new Map<NodeId, NodeRecord>()
    const kept: { rec: NodeRecord; prevConfig: Record<string, unknown> }[] = []
    for (const gn of graph.nodes) {
      const def = this.registry.get(gn.type)
      const config = def ? { ...defaultConfig(def), ...gn.config } : { ...gn.config }
      const prev = this.nodes.get(gn.id)
      if (prev && prev.type === gn.type) {
        kept.push({ rec: prev, prevConfig: prev.config })
        prev.config = config
        next.set(gn.id, prev)
      } else {
        next.set(gn.id, this.newRecord(gn.id, gn.type, def, config))
      }
    }
    this.nodes = next
    this.edgeList = graph.edges.filter((e) => next.has(e.source) && next.has(e.target))
    this.edges = new Map(this.edgeList.map((e) => [e.id, e]))
    // After the new graph is in place, so rejections reply along the current edges.
    for (const { rec, prevConfig } of kept) {
      rec.def?.onConfig?.(this.ctx(rec), prevConfig)
      rec.processor.reconfigure()
    }
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

  /** Rolling throughput / latency / error rate of completed requests at recordsMetrics originators. */
  metrics(): MetricsSnapshot {
    return this.rolling.snapshot(this.now)
  }

  // ---------------------------------------------------------------- ticking

  private tick(): void {
    this.scheduler.after(TICK_MS, () => this.tick())
    for (const rec of this.nodes.values()) rec.def?.onTick?.(this.ctx(rec), TICK_MS)
  }

  private metricsTick(): void {
    this.scheduler.after(METRICS_TICK_MS, () => this.metricsTick())
    this.events.emit('metrics:tick', this.metrics())
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
      // An empty trail means this node originated the request: the round trip is complete.
      if (msg.trail.length === 0 && def?.recordsMetrics) {
        this.rolling.record(this.now, this.now - msg.createdAt, msg.status === 'ok')
        // The originator's own counters show how its requests ended.
        this.bump(rec, msg.status === 'ok' ? 'ok' : 'errors')
      }
      if (def?.onResponse) def.onResponse(msg, this.ctx(rec))
      else this.forwardResponse(rec.id, msg)
    } else if (!def) {
      this.drop(rec.id, msg, 'unknown-type')
    } else {
      def.onMessage(msg, this.ctx(rec))
    }
  }

  /**
   * Appends `from` to a copy of the trail (so fan-out copies don't share it), or drops on loop: once
   * depth (hops of its ancestors) + trail reaches MAX_TRAIL. A looping message `from` itself created
   * (empty trail) has nobody upstream to answer, so its error response is delivered back to `from`.
   */
  private send(from: NodeId, to: NodeId, msg: Message): void {
    if ((msg.depth ?? 0) + msg.trail.length >= MAX_TRAIL) {
      this.drop(from, msg, 'loop')
      if (msg.trail.length === 0) this.nackSelf(from, msg)
      return
    }
    this.transmit(from, to, { ...msg, trail: [...msg.trail, from] })
  }

  /** Build the response to `msg` (its meta, patched by `r.meta`) and send it one hop back along its trail. No-op on an empty trail. */
  private respond(from: NodeId, msg: Message, r: ReplyInfo): void {
    if (msg.trail.length === 0) return
    const res: Message = {
      id: this.nextId(),
      kind: 'response',
      meta: { ...msg.meta, ...r.meta },
      trail: msg.trail.slice(0, -1),
      // Kept from the request so the originator can compute latency = now - createdAt.
      createdAt: msg.createdAt,
      status: r.status,
      code: r.code,
      replyTo: msg.id,
    }
    this.transmit(from, msg.trail[msg.trail.length - 1], res)
  }

  /** Next instant (never re-entrant), deliver an error response for `msg` to the node that created it. */
  private nackSelf(at: NodeId, msg: Message): void {
    const res: Message = {
      id: this.nextId(),
      kind: 'response',
      meta: { ...msg.meta },
      trail: [],
      createdAt: msg.createdAt,
      status: 'error',
      code: 503,
      replyTo: msg.id,
    }
    this.scheduler.after(0, () => {
      const rec = this.nodes.get(at)
      if (rec) this.deliver(rec, res)
    })
  }

  private forwardResponse(from: NodeId, res: Message): void {
    if (res.trail.length === 0) return // reached the originator: the response ends here
    this.transmit(from, res.trail[res.trail.length - 1], { ...res, trail: res.trail.slice(0, -1) })
  }

  /**
   * Emit message:dropped, count an error, and answer with an error response: a request gets its
   * error reply and a message/event a generic nack, so whoever pushed it (a queue or broker waiting
   * for the ack) frees its slot. Responses are never answered.
   */
  private drop(at: NodeId, msg: Message, reason: string, code?: number): void {
    const effective = msg.kind === 'response' ? code : (code ?? 503)
    this.events.emit('message:dropped', { msg, at, reason, code: effective })
    const rec = this.nodes.get(at)
    if (rec) this.bump(rec, 'errors')
    if (msg.kind !== 'response') this.respond(at, msg, { status: 'error', code: effective! })
  }


  /** Schedule a node-owned callback; skipped if the node was removed or replaced meanwhile. */
  private scheduleFor(rec: NodeRecord, ms: number, fn: () => void): void {
    this.scheduler.after(ms, () => {
      if (this.nodes.get(rec.id) === rec) fn()
    })
  }

  // ---------------------------------------------------------------- helpers

  private newRecord(id: NodeId, type: string, def: ComponentDef | undefined, config: Record<string, unknown>): NodeRecord {
    const rec = { id, type, def, config, state: def ? def.initialState() : {}, stats: zeroStats() } as NodeRecord
    rec.processor = new Processor({
      config: () => rec.config,
      stats: rec.stats,
      // A job released after its node was removed must not emit stats for a node that no longer exists.
      statsChanged: () => {
        if (this.nodes.get(rec.id) === rec) this.emitStats(rec)
      },
      schedule: (ms, fn) => this.scheduleFor(rec, ms, fn),
      drop: (msg, reason, code) => this.drop(rec.id, msg, reason, code),
    })
    return rec
  }

  private edgeBetween(a: NodeId, b: NodeId): EdgeId | null {
    const forward = this.edgeList.find((e) => e.source === a && e.target === b)
    const reverse = forward ?? this.edgeList.find((e) => e.source === b && e.target === a)
    return reverse?.id ?? null
  }

  private bump(rec: NodeRecord, field: keyof NodeStats): void {
    rec.stats[field]++
    this.emitStats(rec)
  }

  private emitStats(rec: NodeRecord): void {
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
          .map((e) => ({ edgeId: e.id, target: e.target, targetType: sim.nodes.get(e.target)!.type, rule: e.rule, ...(e.weight !== undefined && { weight: e.weight }) })),
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
        ...(parent ? { depth: (parent.depth ?? 0) + parent.trail.length } : {}),
      }),
      send: (target, msg) => sim.send(rec.id, target, msg),
      reply: (msg, r) => {
        sim.bump(rec, r.status === 'ok' ? 'ok' : 'errors')
        sim.respond(rec.id, msg, r)
      },
      forwardResponse: (res) => sim.forwardResponse(rec.id, res),
      drop: (msg, reason, code) => sim.drop(rec.id, msg, reason, code),
      process: (msg, done) => rec.processor.process(msg, done),
      occupy: (msg, run) => rec.processor.occupy(msg, run),
      schedule: (ms, fn) => sim.scheduleFor(rec, ms, fn),
      label: (text, tone) => sim.events.emit('node:label', { nodeId: rec.id, text, tone }),
      random: () => sim.random(),
    }
  }
}

function zeroStats(): NodeStats {
  return { inFlight: 0, queued: 0, ok: 0, errors: 0 }
}
