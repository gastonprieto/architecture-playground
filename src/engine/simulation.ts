import { Emitter } from './emitter'
import { createRandom } from './random'
import { RollingMetrics } from './metrics'
import { Processor } from './processing'
import { readProcessing } from './processing'
import { defaultConfig, type ComponentDef, type Ctx, type InEdge, type OutEdge, type Registry, type ReplyInfo, type Tone } from './registry'
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
  /** Ids of the requests this node sent and is still waiting an answer for (stats.pending is its size). */
  awaiting: Set<string>
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
  /** Flow-only mode: capacity limits, rate limits and random failures are ignored; only a node that is off fails. */
  private flowOnly = false
  /** Sim time of the last counter reset: traffic created earlier no longer counts. */
  private countFrom = 0
  private flowConfigs = new WeakMap<Record<string, unknown>, Record<string, unknown>>()

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

  /**
   * Flow-only mode on/off. The ok/errors counters and the metrics start over, so they only show how
   * traffic created in the current mode ended (what was already travelling is not counted). Entering
   * it starts whatever was waiting in a node's queue; leaving it keeps what is in flight.
   */
  setFlowOnly(on: boolean): void {
    if (this.flowOnly === on) return
    this.flowOnly = on
    this.countFrom = this.now
    this.rolling = new RollingMetrics()
    for (const rec of this.nodes.values()) {
      rec.stats.ok = 0
      rec.stats.errors = 0
      this.emitStats(rec)
      rec.processor.reconfigure()
    }
    // Right away, so the metrics bar shows the reset even while paused.
    this.events.emit('metrics:tick', this.metrics())
  }

  /** The config a component sees: in flow-only mode, without the limits that make traffic fail. */
  private configOf(rec: NodeRecord): Record<string, unknown> {
    if (!this.flowOnly) return rec.config
    let c = this.flowConfigs.get(rec.config)
    if (!c) {
      c = { ...rec.config, ...FLOW_OVERRIDES }
      this.flowConfigs.set(rec.config, c)
    }
    return c
  }

  /** The config a node's processing reads; in flow-only mode with unlimited slots and queue. */
  private processingOf(rec: NodeRecord): Record<string, unknown> {
    const base = processingConfigOf(rec)
    return this.flowOnly ? { ...base, capacity: Infinity, queueMax: Infinity } : base
  }

  runAction(nodeId: NodeId, action: string): void {
    const rec = this.nodes.get(nodeId)
    // A node that is off does nothing, not even what the user triggers on it.
    if (rec && !isDown(rec)) rec.def?.actions?.[action]?.run(this.ctx(rec))
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
      this.settle(rec, msg)
      // An empty trail means this node originated the request: the round trip is complete.
      if (msg.trail.length === 0 && def?.recordsMetrics) {
        // The rolling metrics and the originator's own counters show how its requests ended.
        if (this.counts(msg)) this.rolling.record(this.now, this.now - msg.createdAt, msg.status === 'ok')
        this.tally(rec, msg, msg.status === 'ok')
      }
      if (def?.onResponse) def.onResponse(msg, this.ctx(rec))
      else this.forwardResponse(rec.id, msg)
    } else if (!def) {
      this.drop(rec.id, msg, 'unknown-type')
    } else if (isDown(rec)) {
      // Off: rejects whatever reaches it with 503 (a poll just finds nobody home). Responses to what it
      // sent before going down still pass, so the requests in flight end.
      if (msg.kind !== 'poll') this.drop(rec.id, msg, 'down', 503)
    } else if (msg.kind === 'poll') {
      // A pull request: the upstream hands over work if it has any. No onPoll (or no work) = nothing
      // happens; the consumer re-polls on its own interval. Polls never get a response.
      def.onPoll?.(msg, this.ctx(rec))
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
      if (msg.trail.length === 0 && msg.kind !== 'poll') {
        // Its own error answer comes back to `from`: it waits for it like for any request it sent.
        this.await(from, msg)
        this.nackSelf(from, msg)
      }
      return
    }
    this.await(from, msg)
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
    // A relay (LB, proxy…) counts the requests it resolved through others, like the ones it answers.
    const rec = this.nodes.get(from)
    if (rec) this.tally(rec, res, res.status === 'ok')
    this.transmit(from, res.trail[res.trail.length - 1], { ...res, trail: res.trail.slice(0, -1) })
  }

  /**
   * Emit message:dropped, count an error, and answer with an error response: a request gets its
   * error reply and a message/event a generic nack, so whoever pushed it (a queue or broker waiting
   * for the ack) frees its slot. Responses are never answered. A poll is silent: it has no round
   * trip (the consumer just re-polls), so it costs no error and gets no nack.
   */
  private drop(at: NodeId, msg: Message, reason: string, code?: number): void {
    if (msg.kind === 'poll') {
      this.events.emit('message:dropped', { msg, at, reason })
      return
    }
    const effective = msg.kind === 'response' ? code : (code ?? 503)
    this.events.emit('message:dropped', { msg, at, reason, code: effective })
    const rec = this.nodes.get(at)
    if (rec) {
      // A response lost on its last hop (edge removed) still ends the wait of the node it was for.
      if (msg.kind === 'response') this.settle(rec, msg)
      this.tally(rec, msg, false)
    }
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
    const rec = { id, type, def, config, state: def ? def.initialState() : {}, stats: zeroStats(), awaiting: new Set<string>() } as NodeRecord
    rec.processor = new Processor({
      config: () => this.processingOf(rec),
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

  /** A request `from` sends now counts as pending until its response comes back to it. */
  private await(from: NodeId, msg: Message): void {
    const rec = this.nodes.get(from)
    if (!rec || msg.kind !== 'request' || rec.awaiting.has(msg.id)) return
    rec.awaiting.add(msg.id)
    rec.stats.pending = rec.awaiting.size
    this.emitStats(rec)
  }

  /** The answer to a pending request reached its sender (or was lost on the way back to it). */
  private settle(rec: NodeRecord, res: Message): void {
    if (res.replyTo === undefined || !rec.awaiting.delete(res.replyTo)) return
    rec.stats.pending = rec.awaiting.size
    this.emitStats(rec)
  }

  /** Count how `msg` ended at `rec` (ok or errors), unless it started before the counters were reset. */
  private tally(rec: NodeRecord, msg: Message, ok: boolean): void {
    if (!this.counts(msg)) return
    rec.stats[ok ? 'ok' : 'errors']++
    this.emitStats(rec)
  }

  /** Traffic that started before the last counter reset (a mode change) is not counted. */
  private counts(msg: Message): boolean {
    return msg.createdAt >= this.countFrom
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
        return sim.configOf(rec)
      },
      get state() {
        return rec.state
      },
      get flowOnly() {
        return sim.flowOnly
      },
      outputs: (): OutEdge[] =>
        sim.edgeList
          .filter((e) => e.source === rec.id)
          .map((e) => ({ edgeId: e.id, target: e.target, targetType: sim.nodes.get(e.target)!.type, rule: e.rule, ...(e.weight !== undefined && { weight: e.weight }) })),
      inputs: (): InEdge[] =>
        sim.edgeList
          .filter((e) => e.target === rec.id)
          .map((e) => ({ edgeId: e.id, source: e.source, sourceType: sim.nodes.get(e.source)!.type })),
      pull: (source) => sim.send(rec.id, source, { id: sim.nextId(), kind: 'poll', meta: {}, trail: [], createdAt: sim.now }),
      // Always the configured slots, also in flow-only mode: they pace a consumer's polling (one poll per slot).
      freeSlots: () => {
        const { capacity } = readProcessing(processingConfigOf(rec))
        const free = capacity - rec.stats.inFlight
        return free > 0 ? free : 0
      },
      peerOutputCount: (id) => sim.edgeList.reduce((n, e) => n + (e.source === id ? 1 : 0), 0),
      peer: (id) => {
        const p = sim.nodes.get(id)
        return p ? { type: p.type, config: sim.configOf(p), processing: sim.processingOf(p) } : undefined
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
        sim.tally(rec, msg, r.status === 'ok')
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

/** Config fields that only make traffic fail by load or chance; flow-only mode neutralizes them. */
const FLOW_OVERRIDES: Record<string, unknown> = { capacity: Infinity, queueMax: Infinity, rateLimit: 0, failRate: 0 }

/** Any component can be switched off (`up: false`), whether or not it processes. */
const isDown = (rec: NodeRecord) => rec.config.up === false

/** The config a node's processing reads: its def's processingConfig of the config, or the config itself. */
function processingConfigOf(rec: NodeRecord): Record<string, unknown> {
  return rec.def?.processingConfig ? rec.def.processingConfig(rec.config) : rec.config
}

function zeroStats(): NodeStats {
  return { inFlight: 0, queued: 0, ok: 0, errors: 0, pending: 0 }
}
