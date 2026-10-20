# Architecture Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web app where you drag architecture components onto a canvas, connect them, and watch requests/messages/events flow between them, animated.

**Architecture:** A pure-TypeScript, DOM-free simulation engine (`src/engine`) runs a discrete-event simulation over a user-defined directed graph and emits events. Component types (`src/components`) plug into the engine through a `defineComponent` registry. A React + React Flow UI (`src/ui`) edits the graph through a zustand store and animates packets by listening to engine events.

**Tech Stack:** Vite, React 18+, TypeScript (strict), `@xyflow/react` 12, `zustand` 5, `lz-string`, Vitest, `@testing-library/react` + jsdom (smoke test only). GitHub Actions deploys to GitHub Pages.

**Spec:** `docs/spec.md`. Read it before any task. This plan argues from it.

## Global Constraints

- UI copy in Spanish with correct accents ("Cliente", "Cola", "Base de datos", "Suscriptor"). Identifiers, types, comments, and commit messages in English.
- `src/engine/**` and `src/components/**` must not import React, `@xyflow/react`, the DOM, or anything under `src/ui/**`.
- No backend. Persistence goes only to `localStorage`, JSON export/import, and the URL hash.
- Vite `base: '/architecture-playground/'`.
- Engine constants: `HOP_MS = 600` (sim ms per hop) and `MAX_TRAIL = 32` (drop reason `'loop'`).
- Engine tests use `new Simulation(graph, { seed, registry })` and `sim.advance(ms)`. Never use real timers or `requestAnimationFrame`.
- Palette tokens from spec §8 live as CSS variables in `src/ui/theme.css`. Semantic colors (`req`, `ok`, `slow`, `err`, `hc`, `redis`, `db`) are exported from `src/ui/colors.ts`.
- Commit after every task, with messages in the `feat:`/`test:`/`chore:` style.

## Review Focus

1. **Editing the graph while the simulation runs** (delete a node with packets in flight, add a server mid-run). Expected: no crash; in-flight messages to the removed node/edge are dropped with reason `'removed'`; surviving nodes keep their stats. Pinned in Task 4 (`setGraph keeps state and drops orphans`).
2. **Cycles** (A→B→A, or a Service whose output feeds back into itself). Expected: the message is dropped with reason `'loop'` once `trail.length > MAX_TRAIL`, and the sim keeps running. Pinned in Task 4 (`drops looping messages`).
3. **Bad import/hash input** (malformed JSON, edges pointing to missing nodes, unknown component types). Expected: a Spanish error message and no crash. Unknown types load and render as "Desconocido"; in the engine they drop everything with reason `'tipo desconocido'`. Pinned in Task 15 and Task 4 (`unknown type drops`).
4. **Flooding** (`rate` 50 on several clients, or a burst of 200). Expected: the UI stays responsive. `rate` max is 50, `burstSize` max is 200, and the overlay draws at most 300 packets (the rest still simulate, they just aren't drawn). Pinned in Task 7 (config bounds) and Task 18 (`MAX_PACKETS`).
5. **Live config changes** (lowering `capacity` below current in-flight, or turning a node down with work queued). Expected: in-flight work finishes; queued requests are rejected with `503`; new arrivals at a down node get `503`. Pinned in Task 5.

---

## File Structure

```
src/engine/types.ts        Graph, Message, EdgeRule, NodeStats, MetricsSnapshot
src/engine/scheduler.ts    priority queue of timed actions over sim time
src/engine/random.ts       seeded RNG (mulberry32)
src/engine/rules.ts        matchRule, longest-prefix helpers
src/engine/registry.ts     defineComponent, field types, Registry
src/engine/simulation.ts   Simulation class, ctx, hop delivery, setGraph
src/engine/processing.ts   capacity/queue/processingTime/up-down for ctx.process
src/engine/metrics.ts      rolling window throughput/p50/p95/error rate
src/components/*.ts        one file per type (client, service, database, load-balancer,
                           reverse-proxy, cache, queue, dlq, worker, broker, subscriber)
src/components/shared/dependencies.ts   parallel/sequential downstream calls (service, worker)
src/components/shared/push.ts           buffered push-to-free-consumer (queue, broker)
src/components/index.ts    defaultRegistry with all types registered
src/presets/*.ts           4 preset graphs + index
src/persistence/*.ts       serialize/parse, localStorage, URL hash
src/ui/                    React app (store, canvas, nodes, edges, overlay, panels)
tests/                     mirrors src/ (engine/, components/, presets/, persistence/, ui/)
.github/workflows/deploy.yml
```

---

### Task 1: Scaffold + scheduler

**Files:**
- Create: Vite react-ts project at the repo root (`package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`), `src/engine/scheduler.ts`, `src/engine/random.ts`, `.gitignore`
- Test: `tests/engine/scheduler.test.ts`

**Interfaces:**
- Produces:
  - `class Scheduler { now: number; at(time: number, fn: () => void): number; after(ms: number, fn: () => void): number; cancel(id: number): void; advance(ms: number): void; clear(): void }`
  - `function createRandom(seed: number): () => number`, which returns floats in `[0, 1)`.

- [ ] **Step 1: Scaffold.** Run `npm create vite@latest . -- --template react-ts`. Then add the dependencies with `npm i @xyflow/react zustand lz-string` and `npm i -D vitest jsdom @testing-library/react`. Set `base: '/architecture-playground/'` and `test: { environment: 'node' }` in `vite.config.ts`. Add the scripts `"test": "vitest run"` and `"typecheck": "tsc -b --noEmit"`. Delete the Vite demo content.
- [ ] **Step 2: Write the failing test** in `tests/engine/scheduler.test.ts`:
  ```ts
  it('runs actions in time order, FIFO on ties, and actions may schedule more', ...)
  // at(100,a); at(50,b); at(100,c); b schedules after(10,d) → advance(100) order = [b,d,a,c], now === 100
  it('does not run actions beyond the advanced window', ...)   // at(200,x); advance(100) → x not called
  it('cancel prevents execution', ...)
  it('createRandom is deterministic per seed', ...)            // same seed → same 5 values; different seed → different
  ```
- [ ] **Step 3: Run** `npx vitest run tests/engine/scheduler.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `Scheduler` with a binary heap keyed by `(time, seq)`. `advance` pops and runs every action with `time <= now + ms`, setting `now` to each action's time as it runs it, and ends at `now + ms`. Implement `createRandom` as mulberry32.
- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run build`. Expected: all green.
- [ ] **Step 6: Commit** with message `chore: scaffold vite app and add sim scheduler`.

### Task 2: Graph types and rules

**Files:**
- Create: `src/engine/types.ts`, `src/engine/rules.ts`
- Test: `tests/engine/rules.test.ts`

**Interfaces:**
- Produces (`types.ts`), copied from spec §4.2–4.3:
  - `NodeId`, `EdgeId`
  - `EdgeRule = { kind: 'pathPrefix'; value: string } | { kind: 'eventType'; value: string }`
  - `GraphNode { id; type; position: { x: number; y: number }; config: Record<string, unknown> }`
  - `GraphEdge { id; source; target; rule?: EdgeRule }`
  - `Graph { nodes: GraphNode[]; edges: GraphEdge[] }`
  - `MessageKind`, `Message` (exactly as in the spec, including `replyTo`)
  - `NodeStats { inFlight: number; queued: number; ok: number; errors: number }`
  - `MetricsSnapshot { throughput: number; p50: number; p95: number; errorRate: number }`
- Produces (`rules.ts`):
  - `matchesPath(rule: EdgeRule | undefined, path: string): number`. Returns the matched prefix length, or `-1` for no match. A missing rule counts as `'/'` and returns 1. An `eventType` rule never matches a path.
  - `matchesEvent(rule: EdgeRule | undefined, eventType: string): boolean`. A missing rule returns `true`; a `pathPrefix` rule returns `false`.
  - `ruleLabel(rule?: EdgeRule): string`. Returns `''`, `'/ordenes*'` or `'OrdenCreada'`.

- [ ] **Step 1: Write failing tests:**
  - `matchesPath({pathPrefix:'/ordenes'}, '/ordenes/envios')` → 8
  - `matchesPath({pathPrefix:'/ordenes'}, '/usuarios')` → -1
  - `matchesPath(undefined, '/x')` → 1
  - `matchesEvent(undefined, 'A')` → true
  - `matchesEvent({eventType:'A'}, 'B')` → false
  - `matchesEvent({pathPrefix:'/'}, 'A')` → false
  - `ruleLabel` returns each of its three forms
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `types.ts` and `rules.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: engine graph types and edge rules`.

### Task 3: Registry and `defineComponent`

**Files:**
- Create: `src/engine/registry.ts`
- Test: `tests/engine/registry.test.ts`

**Interfaces:**
- Consumes: `Message` and `NodeId` from Task 2. `Ctx` is declared here as an interface; Task 4 implements it.
- Produces:
  ```ts
  type Field =
    | { type: 'number'; label: string; default: number; min: number; max: number; step?: number; unit?: string }
    | { type: 'boolean'; label: string; default: boolean }
    | { type: 'select'; label: string; default: string; options: { value: string; label: string }[] }
    | { type: 'text'; label: string; default: string }
    | { type: 'mix'; label: string; default: { value: string; weight: number }[] }
  type Tone = 'req' | 'ok' | 'slow' | 'err' | 'hc' | 'redis' | 'db'
  interface OutEdge { edgeId: EdgeId; target: NodeId; targetType: string; rule?: EdgeRule }
  interface Ctx<C = any, S = any> {
    nodeId: NodeId; now: number; config: C; state: S
    outputs(): OutEdge[]
    peer(id: NodeId): { type: string; config: Record<string, unknown> } | undefined
    newMessage(kind: MessageKind, meta: Message['meta'], parent?: Message): Message
    send(target: NodeId, msg: Message): void          // appends this node to msg.trail
    reply(msg: Message, r: { status: 'ok' | 'error'; code: number }): void
    forwardResponse(res: Message): void               // pass a response one hop further back
    drop(msg: Message, reason: string, code?: number): void
    process(msg: Message, done: () => void): void
    schedule(ms: number, fn: () => void): void
    label(text: string, tone: Tone): void
    random(): number
  }
  interface ComponentDef<C = any, S = any> {
    type: string; label: string; icon: string; color: Tone
    config: Record<string, Field>
    initialState(): S
    onMessage(msg: Message, ctx: Ctx<C, S>): void
    onResponse?(res: Message, ctx: Ctx<C, S>): void
    onTick?(ctx: Ctx<C, S>, dtMs: number): void
    actions?: Record<string, { label: string; run(ctx: Ctx<C, S>): void }>
    recordsMetrics?: boolean   // true only for client
  }
  function defineComponent<C, S>(def: ComponentDef<C, S>): ComponentDef<C, S>  // injects config.name: text field defaulting to def.label
  const processingFields: Record<'up' | 'processingTime' | 'capacity' | 'queueMax', Field>
  // up: boolean 'Activo' true · processingTime: number 'Tiempo de proceso' 400 [50..5000] step 50 'ms'
  // capacity: number 'Capacidad' 2 [1..50] · queueMax: number 'Cola máx.' 10 [0..500]
  class Registry { register(def): void; get(type): ComponentDef | undefined; list(): ComponentDef[] }
  function defaultConfig(def: ComponentDef): Record<string, unknown>
  ```

- [ ] **Step 1: Write failing tests:**
  - `defineComponent` adds a `name` field whose default equals `label`.
  - `defaultConfig` maps every field to its default.
  - `register` with a duplicate type throws.
  - `list()` keeps insertion order.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the registry.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: component registry and defineComponent`.

### Task 4: Simulation core

**Files:**
- Create: `src/engine/simulation.ts`
- Test: `tests/engine/simulation.test.ts`, with test-only components `echo` (replies ok 200 on request) and `fwd` (sends to its first output, no `onResponse`) defined in `tests/engine/fixtures.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  ```ts
  const HOP_MS = 600, MAX_TRAIL = 32
  interface SimEvents {
    'message:sent': { msg: Message; from: NodeId; to: NodeId; edgeId: EdgeId | null; duration: number; at: number }
    'message:arrived': { msg: Message; at: NodeId }
    'message:dropped': { msg: Message; at: NodeId; reason: string; code?: number }
    'node:stats': { nodeId: NodeId; stats: NodeStats }
    'node:label': { nodeId: NodeId; text: string; tone: Tone }
    'metrics:tick': MetricsSnapshot
    'sim:reset': {}
  }
  class Simulation {
    constructor(graph: Graph, opts: { seed?: number; registry: Registry })  // engine never imports components; UI passes defaultRegistry
    get now(): number
    advance(ms: number): void        // also calls onTick for each node every 100 sim-ms
    on<K extends keyof SimEvents>(k: K, fn: (p: SimEvents[K]) => void): () => void
    setGraph(graph: Graph): void
    runAction(nodeId: NodeId, action: string): void
    inject(nodeId: NodeId, msg: Message): void   // test helper: deliver msg to nodeId now
    nodeStats(id: NodeId): NodeStats
    nodeState<S>(id: NodeId): S
    metrics(): MetricsSnapshot       // implemented in Task 6, returns zeros until then
  }
  ```
- Delivery rules:
  - `send` emits `message:sent` with `edgeId` set to the edge connecting the two nodes in either direction, or `null` when there is none.
  - The message arrives `HOP_MS` later. On arrival the engine emits `message:arrived` and calls the target's `onMessage`.
  - A `response` arriving at a node calls that node's `onResponse`. If the node doesn't define one, the engine calls `forwardResponse`.
  - `reply` builds the response: `kind: 'response'`, `replyTo = msg.id`, `trail = msg.trail` minus its last element. The engine sends it to the last element of `msg.trail`.
  - `drop` on a `request` also replies `{status: 'error', code: code ?? 503}`.

- [ ] **Step 1: Write failing tests:**
  - `request round trip`: echo ← fwd ← origin(fwd). Inject a request at A. Sent events go A→B→C, the response goes C→B→A, and the response reaches A at `4 * HOP_MS`.
  - `send without edge uses edgeId null`.
  - `drops looping messages`: A→B→A cycle of `fwd` nodes. Within 40 hops there is a `message:dropped` with reason `'loop'`, and `advance` returns normally.
  - `unknown type drops`: a node of type `'nope'` drops with reason `'tipo desconocido'`.
  - `setGraph keeps state and drops orphans`: remove the target while a message is in flight. Expect `message:dropped` with reason `'removed'`, and the surviving node's `nodeState` stays the same object.
  - `runAction calls def.actions[name].run`.
  - `deterministic`: two sims with the same seed emit identical event sequences.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `Simulation`. Use one `Scheduler`. Keep runtime node records (`def`, `config`, `state`, `stats`) in a `Map<NodeId, …>`. `ctx` is created per call. A tiny typed event emitter is enough for events.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: simulation core with hop-by-hop delivery`.

### Task 5: `ctx.process` (capacity, queue, up/down)

**Files:**
- Create: `src/engine/processing.ts`, wired into `ctx.process` in `simulation.ts`
- Test: `tests/engine/processing.test.ts`

**Interfaces:**
- Consumes: the `processingFields` keys (`up`, `processingTime`, `capacity`, `queueMax`) read from the node's config.
- Produces the behavior of `ctx.process(msg, done)`:
  - A down node (`up === false`) drops with `'caído'`/503.
  - When there is a free slot, `done()` runs after `processingTime`, and `stats.inFlight` changes by ±1.
  - Otherwise the message waits in a FIFO queue (`stats.queued`). If the queue already holds `queueMax` items, the message is dropped with `'cola llena'`/503.
  - Every stats change emits `node:stats`.
  - `stats.ok` and `stats.errors` are counted by `reply` (by status) and `drop`.

- [ ] **Step 1: Write failing tests** using a fixture `proc` (processes, then replies ok 200):
  - `processes up to capacity concurrently, queues the rest` (capacity 2, 3 injected → at t=0 inFlight 2, queued 1; third completes at 2×processingTime)
  - `rejects with 503 when queue is full`
  - `down node rejects new arrivals with 503`
  - `turning a node down rejects its queued items but lets in-flight finish` (pins Review Focus 5)
  - `lowering capacity below inFlight lets current work finish and starts no new work until below`
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `processing.ts`. `setGraph` and config updates must re-evaluate queued items: if the node went down, reject them.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: capacity, queueing and up/down in ctx.process`.

### Task 6: Metrics

**Files:**
- Create: `src/engine/metrics.ts`, wired into `Simulation`
- Test: `tests/engine/metrics.test.ts`

**Interfaces:**
- Produces:
  - `class RollingMetrics { record(at: number, latency: number, ok: boolean): void; snapshot(now: number): MetricsSnapshot }`, over a 5000 ms window.
  - `throughput` is completions per second.
  - `p50` and `p95` are latencies in ms, using nearest-rank.
  - `errorRate` is in `0..1`.
  - The engine records a completion when a response reaches the originator of a request whose originating node's def has `recordsMetrics: true`. The latency is `now - request.createdAt`.
  - `metrics:tick` is emitted every 500 sim-ms.

- [ ] **Step 1: Write failing tests:**
  - With latencies `[100..1000 step 100]` all ok: p50 = 500, p95 = 1000, throughput = 10/5 = 2.
  - Entries older than 5000 ms are evicted.
  - errorRate = errors / total.
  - With no data, everything is 0.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `RollingMetrics` and wire it into the engine.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: rolling metrics`.

### Task 7: Client, Service, Database and default registry

**Files:**
- Create: `src/components/client.ts`, `service.ts`, `database.ts`, `shared/dependencies.ts`, `index.ts`
- Test: `tests/components/client-service.test.ts`

**Interfaces:**
- Produces:
  - `defaultRegistry: Registry` in `src/components/index.ts`. Every later component task adds its def here.
  - `callDependencies(ctx, msg, mode: 'parallel' | 'sequential', done: (ok: boolean) => void): void`. It sends a child request (`parentId = msg.id`, same `meta`) to every output whose `targetType` is not `queue`/`broker`/`dlq`, and also to queue/broker outputs. It completes with `ok` only if every child response is ok. With no outputs it calls `done(true)` immediately. Pending children are tracked in `ctx.state.pending`.
- Component configs:
  - **client** (`Cliente`, 💻, `req`, `recordsMetrics: true`):
    - `kind` select request|event (`Request`/`Evento`), default request
    - `rate` number 0..50 default 2 'req/s'
    - `mix` default `[{value:'/', weight:1}]`, which is the path or eventType depending on `kind`
    - `burstSize` 1..200 default 20
    - Actions `send1` ('Enviar 1') and `burst` ('Ráfaga'), with the burst spread evenly over 1000 ms.
    - It sends to its first output. With no outputs it drops `'sin salida'`.
    - `meta.clientId = nodeId`.
    - `onTick` accumulates `rate * dt` and sends whole units.
  - **service** (`Servicio`, ⚙️, `ok`): `processingFields` plus `mode` select parallel|sequential ('Paralelo'/'Secuencial'). It processes, then runs `callDependencies`, then replies 200 or 502.
  - **database** (`Base de datos`, 🗄️, `db`): `processingFields` with `processingTime` default 300. It processes and replies 200.

- [ ] **Step 1: Write failing tests:**
  - `client rate 2 sends ~2 req/s` (20 s → 38..42 requests).
  - `burst sends burstSize over 1s`.
  - `rate field max is 50 and burstSize max is 200` (pins Review Focus 4).
  - `client→service→db completes ok and records latency`. Latency = 4 hops + service time + db time.
  - `parallel waits for the slowest dependency; sequential sums them`.
  - `dependency error yields 502 to client`.
  - `client without outputs drops 'sin salida'`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the three components and `callDependencies`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: client, service and database components`.

### Task 8: Load Balancer

**Files:**
- Create: `src/components/load-balancer.ts`
- Test: `tests/components/load-balancer.test.ts`

**Interfaces:**
- Config: `algorithm` select with options `round-robin` 'Round Robin', `least-connections` 'Least Connections', `random` 'Random', `ip-hash` 'IP Hash' and `weighted` 'Weighted'; `healthChecks` boolean 'Health checks' default false.
- Behavior:
  - It forwards the request itself (not a child), so the response passes back through it. It tracks in-flight per target via `onResponse` and then calls `forwardResponse`.
  - With health checks on, it skips targets whose `peer.config.up === false`. If no targets are available, it drops with 503.
  - `weighted` weights by `peer.config.capacity`.

- [ ] **Step 1: Write failing tests:**
  - round-robin over 3 targets → 1,2,3,1,2,3
  - least-connections picks the target with the fewest in flight
  - ip-hash sends the same `clientId` to the same target
  - weighted with capacities 3,1 → about 75/25 over 400 requests (±8%)
  - health checks off + one target down → about 1/3 of requests get 503
  - health checks on → 0 errors
  - all targets down → 503
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the load balancer.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: load balancer component`.

### Task 9: Reverse Proxy

**Files:**
- Create: `src/components/reverse-proxy.ts`
- Test: `tests/components/reverse-proxy.test.ts`

**Interfaces:**
- Config:
  - `authFailRate` 0..1 default 0 'Rechazo auth'
  - `rateLimit` 0..100 default 0 'Rate limit' 'req/s' (0 = off, counted over a 1 s sliding window)
  - `cacheHitRate` 0..1 default 0 'Cache hit'
- Behavior, in order:
  1. Rate limit → reply 429.
  2. Auth → reply 401.
  3. Cache hit → reply 200 with `label('HIT','redis')`.
  4. Route with the longest `matchesPath` → forward the request.
  5. No match → reply 404.

- [ ] **Step 1: Write failing tests:**
  - `/ordenes/envios` goes to the `/ordenes/envios` edge over `/ordenes`
  - an edge without a rule catches unmatched paths
  - with no match the reply is 404
  - `authFailRate: 1` → every reply is 401
  - `rateLimit: 1` with 5 requests in 1 s → 4 replies are 429
  - `cacheHitRate: 1` → no request reaches a service
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the proxy.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: reverse proxy component`.

### Task 10: Cache

**Files:**
- Create: `src/components/cache.ts`
- Test: `tests/components/cache.test.ts`

**Interfaces:**
- Config: `hitRate` 0..1 default 0.8 'Hit rate', plus `processingTime` (default 50).
- Behavior:
  - Hit → reply 200 with `label('HIT','redis')`.
  - Miss → `label('MISS','slow')` and forward to the first output. When the response comes back, increment `state.stored` and call `forwardResponse`.
  - Miss with no output → drop 503.

- [ ] **Step 1: Write failing tests:**
  - `hitRate 1` → the DB receives 0
  - `hitRate 0` → the DB receives everything and `state.stored` counts them
  - a miss without an output gets 503
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the cache.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: cache component`.

### Task 11: Queue, Worker, DLQ

**Files:**
- Create: `src/components/queue.ts`, `worker.ts`, `dlq.ts`, `shared/push.ts`
- Test: `tests/components/queue.test.ts`

**Interfaces:**
- Produces:
  - `pushReady(ctx, buffers: Record<NodeId, Message[]>, inFlight: Record<NodeId, number>, targets: NodeId[]): void`. It sends buffered messages to every target that is up and whose in-flight count is below `peer.config.capacity`.
  - The broker reuses this in Task 12.
- **queue** (`Cola`, 📬, `req`):
  - Config: `queueMax` default 50, `maxRetries` 0..10 default 3.
  - On a `request`: reply 202 immediately with `label('202','ok')`, then enqueue a derived `message` (`parentId`, `attempt: 0`).
  - On a `message`: enqueue it.
  - When `state.items.length >= queueMax`, reply 503 or drop.
  - Workers are the outputs whose `targetType !== 'dlq'`; the DLQ is the first output whose `targetType === 'dlq'`.
  - On a nack (an error response): if `attempt < maxRetries`, re-enqueue with `attempt + 1`; otherwise send to the DLQ, or drop `'sin DLQ'` if there is none.
  - `state.items: Message[]` is exposed for the queue cells in the UI.
- **worker** (`Worker`, 🛠️, `ok`):
  - Config: `processingFields` plus `failRate` 0..1 default 0 'Tasa de fallo'.
  - It processes, runs `callDependencies`, then replies 200, or 500 when `random() < failRate` or a dependency failed.
- **dlq** (`DLQ`, ☠️, `err`):
  - Stores incoming messages in `state.items` and replies nothing.
  - Action `reprocess` ('Reprocesar') sends each message back to `msg.trail.at(-1)`, the origin queue, with `attempt: 0`, then clears `state.items`.

- [ ] **Step 1: Write failing tests:**
  - the client gets 202 at `2*HOP_MS` regardless of worker time
  - with 3 workers of capacity 1, at most 3 messages are in flight
  - workers that are down receive nothing
  - with `failRate 1, maxRetries 2`, each message is attempted 3 times and then lands in the DLQ
  - without a DLQ the message is dropped `'sin DLQ'`
  - `reprocess` empties the DLQ and messages re-enter the queue
  - a full queue answers 503
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the queue, worker, DLQ and `pushReady`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: queue, worker and dlq components`.

### Task 12: Broker and Subscriber

**Files:**
- Create: `src/components/broker.ts`, `subscriber.ts`
- Test: `tests/components/broker.test.ts`

**Interfaces:**
- **broker** (`Broker`, 📡, `hc`):
  - On a `request`: reply 202, then publish an `event` derived from it (`meta.eventType = meta.path ?? meta.eventType`).
  - On an `event`: publish it.
  - Publishing means: for each output where `matchesEvent(rule, eventType)`, push a copy into that subscriber's lane (`state.lanes[target]`) via `pushReady`.
  - A subscriber's ack (a response) frees its slot.
  - With no matching output: `label('sin suscriptores','slow')` and drop.
- **subscriber** (`Suscriptor`, 📥, `ok`):
  - Config: `processingFields` plus `emits` text default `''` 'Emite evento'.
  - It processes, then replies 200 (the ack). If `emits` is non-empty, it sends a new `event` with that `eventType` to every output.

- [ ] **Step 1: Write failing tests:**
  - an event without rules fans out to all 4 subscribers
  - an `eventType` rule filters subscribers
  - a slow subscriber accumulates its lane while fast ones stay empty
  - a down subscriber gets its lane drained after it comes back up
  - `emits: 'FacturaEmitida'` produces a chained event at the next broker
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the broker and subscriber.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: broker and subscriber components`.

### Task 13: Presets

**Files:**
- Create: `src/presets/load-balancer.ts`, `sync-vs-queue.ts`, `pubsub.ts`, `reverse-proxy.ts`, `index.ts`
- Test: `tests/presets/presets.test.ts`

**Interfaces:**
- Produces: `interface Preset { id: string; name: string; description: string; graph: Graph }` and `presets: Preset[]`.
- Topologies (spec §7). Node `name`s are in Spanish, positions are laid out left→right on a 250 px column grid, and ids are stable and readable (`lb`, `srv-1`, `db`):
  1. **`load-balancer`** "Load balancer": Navegador and App móvil → LB (round robin) → Servidor 1–3 → Base de datos.
  2. **`sync-vs-queue`** "Sync vs cola", two independent lanes:
     - Cliente (rate 4) → Servicio (capacity 2, processingTime 1500)
     - Cliente (rate 4) → Cola → Worker 1–3 (capacity 1, processingTime 1500), with the Cola also connected to a DLQ
  3. **`pubsub`** "Pub/sub": Órdenes (client, kind event, mix `OrdenCreada`) → Broker → Facturación, Stock, Mails, Analytics. Analytics has processingTime 2500.
  4. **`reverse-proxy`** "Proxy reverso": Navegador and App móvil (mix `/usuarios`, `/ordenes`, `/pagos`, `/static`) → Proxy → Usuarios, Órdenes, Pagos, Web. Edge rules are `/usuarios`, `/ordenes`, `/pagos`, and no rule for Web.

- [ ] **Step 1: Write failing tests.** For each preset, run 30 s with seed 1, then check:
  - load-balancer: errorRate 0, and each Servidor has `ok > 0`
  - sync-vs-queue: the sync lane's client has errors > 0 (503); the queue lane's client has errors 0, and all its responses are 202
  - pubsub: all 4 subscribers have `ok > 0`, and Analytics' lane length is greater than Stock's
  - reverse-proxy: the Usuarios service only ever receives paths starting with `/usuarios`, and Web only receives `/static`
  - every preset passes `parseGraph(serializeGraph(g))` round-trip (this one goes green after Task 15; mark it `it.todo` until then)
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Write** the presets.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: presets from the four decks`.

### Task 14: Editor store

**Files:**
- Create: `src/ui/store/editor.ts`
- Test: `tests/ui/editor.test.ts`

**Interfaces:**
- Consumes: `Graph`, `defaultRegistry`, `defaultConfig`.
- Produces (zustand, `useEditor`):
  ```ts
  type Selection = { kind: 'node' | 'edge'; id: string } | null
  interface EditorState {
    graph: Graph; selection: Selection; past: Graph[]; future: Graph[]
    addNode(type: string, position: { x: number; y: number }): NodeId   // id `${type}-${random 6 chars}`, config = defaultConfig
    connect(source: NodeId, target: NodeId): EdgeId | null              // null on self-loop or duplicate
    moveNode(id: NodeId, position, commit: boolean): void               // commit=false during drag (no history)
    removeElements(ids: string[]): void                                  // removing a node removes its edges
    updateNodeConfig(id: NodeId, patch: Record<string, unknown>): void
    setEdgeRule(id: EdgeId, rule: EdgeRule | undefined): void
    select(sel: Selection): void
    loadGraph(graph: Graph): void                                        // clears history
    undo(): void; redo(): void                                           // history capped at 100
  }
  ```

- [ ] **Step 1: Write failing tests:**
  - `addNode` fills in the default config
  - `connect` rejects self-loops and duplicates
  - removing a node cascades to its edges
  - `undo`/`redo` restore graphs
  - `moveNode(commit=false)` doesn't add history
  - history is capped at 100
  - `loadGraph` clears history
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the store with immutable updates.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: editor store with undo/redo`.

### Task 15: Persistence

**Files:**
- Create: `src/persistence/serialize.ts`, `storage.ts`, `hash.ts`
- Test: `tests/persistence/persistence.test.ts`

**Interfaces:**
- Produces:
  - `serializeGraph(g: Graph): string`, as `JSON.stringify({ version: 1, graph }, null, 2)`.
  - `parseGraph(text: string): { ok: true; graph: Graph } | { ok: false; error: string }`. Errors, in Spanish:
    - `'JSON inválido'`
    - `'Formato no reconocido'` (wrong `version` or shape)
    - `'La arista X apunta a un nodo inexistente'`
    - Unknown node types are accepted.
  - `saveLocal(g)` / `loadLocal(): Graph | null` under the key `'architecture-playground:graph'`. Both use try/catch and never throw.
  - `encodeHash(g): string` (`'#g=' + lz-string compressToEncodedURIComponent`) and `decodeHash(hash: string): Graph | null`.
  - `initialGraph(): Graph` loads in this order: URL hash, then localStorage, then the `load-balancer` preset.

- [ ] **Step 1: Write failing tests:**
  - round-trip through serialize and parse
  - each of the three errors
  - unknown types are accepted (pins Review Focus 3)
  - hash round-trip
  - `decodeHash('#g=garbage')` returns `null`
  - `loadLocal` returns `null` when `localStorage` throws (stub it)
  - `initialGraph` follows the precedence order
  - Also un-todo the preset round-trip from Task 13.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** persistence.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: json, localStorage and url-hash persistence`.

### Task 16: App shell, palette and canvas

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/theme.css`, `src/ui/colors.ts`, `src/ui/geometry.ts`, `src/ui/Palette.tsx`, `src/ui/canvas/Canvas.tsx`, `src/ui/canvas/ArchNode.tsx`, `src/ui/canvas/ArchEdge.tsx`, `src/ui/useIsMobile.ts`
- Modify: `src/main.tsx`
- Test: `tests/ui/geometry.test.ts`, `tests/ui/app.smoke.test.tsx` (jsdom; stub `ResizeObserver`)

**Interfaces:**
- Produces (`geometry.ts`, ported from the decks' `sim.js` `cubic`/`curve`/`edge`):
  - `type Box = { x: number; y: number; hw: number; hh: number }` (center-based)
  - `edgePoint(a: Box, b: Box): Point`, the point on a's border facing b
  - `cubicPoint(p0: Point, p1: Point, t: number): Point`
  - `curvePath(p0: Point, p1: Point): string`
  - `boxOf(internalNode): Box`, built from `internals.positionAbsolute` and `measured`
- Layout:
  - Toolbar on top (Task 18 fills it in).
  - Palette on the left: "Componentes", one draggable tile per `defaultRegistry.list()` showing icon and label.
  - Canvas in the center; Inspector on the right (Task 17); MetricsBar at the bottom (Task 18).
- Canvas:
  - `ReactFlow` wired to `useEditor`. Nodes and edges are mapped from `graph`.
  - `onConnect` calls `connect`.
  - Dragging calls `moveNode` with `commit` set on `onNodeDragStop`.
  - Delete/Backspace calls `removeElements`.
  - Selection calls `select`.
  - Dropping a palette tile calls `addNode` at `screenToFlowPosition`.
  - `ArchEdge` is a floating edge: `curvePath(edgePoint(src,tgt), edgePoint(tgt,src))` with an arrowhead, plus a `ruleLabel` label.
  - `ArchNode` shows the icon, `config.name`, and the type label. Unknown types render with the "Desconocido" label in `err` color.
- Mobile (`useIsMobile`: width < 768 or `?mobile=1`):
  - Hide the palette and the inspector.
  - Set `nodesDraggable`, `nodesConnectable` and `elementsSelectable` to false.

- [ ] **Step 1: Write failing tests:**
  - `edgePoint` of two boxes at the same y lands on the facing vertical borders
  - `cubicPoint` at `t=0` and `t=1` returns the endpoints
  - smoke: `render(<App/>)` shows "Componentes" and "Cliente"
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the shell, palette and canvas. `App` calls `useEditor.getState().loadGraph(initialGraph())` once on mount and `saveLocal` on every graph change, debounced to 500 ms.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS. Then check by hand in `npm run dev`: dragging, connecting and deleting work, and the preset graph renders.
- [ ] **Step 5: Commit** with message `feat: canvas, palette and floating edges`.

### Task 17: Inspector

**Files:**
- Create: `src/ui/Inspector.tsx`, `src/ui/fields/*.tsx` (`NumberField`, `BooleanField`, `SelectField`, `TextField`, `MixField`)
- Test: `tests/ui/inspector.test.tsx`

**Interfaces:**
- Consumes: `useEditor`, `defaultRegistry`, and a `runAction(nodeId, name)` prop that Task 18 wires to the simulation.
- Behavior:
  - A selected node shows one control per `def.config` field, in definition order:
    - number: slider plus input, clamped to min/max, with the unit shown
    - mix: rows of value + weight with "Agregar" and "Quitar"
  - Then come buttons for `def.actions` and a "Borrar" button.
  - Every change calls `updateNodeConfig`.
  - A selected edge shows "Regla" with a select (`Sin regla`, `Path empieza con`, `Tipo de evento`) and a value input. Changes call `setEdgeRule`.
  - With nothing selected, the panel shows: "Arrastrá componentes desde la izquierda y conectalos. Seleccioná uno para configurarlo."

- [ ] **Step 1: Write failing tests:**
  - selecting a load balancer shows "Algoritmo" options
  - changing `capacity` to 99 clamps to 50
  - the edge rule editor sets `{kind:'pathPrefix', value:'/ordenes'}`
  - the client shows the "Enviar 1" and "Ráfaga" buttons, which call `runAction`
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the inspector.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat: config-driven inspector`.

### Task 18: Live simulation: runtime, animation, metrics, toolbar

**Files:**
- Create: `src/ui/runtime/useSimulation.ts`, `src/ui/runtime/runtimeStore.ts`, `src/ui/canvas/PacketLayer.tsx`, `src/ui/canvas/FloatingLabels.tsx`, `src/ui/Toolbar.tsx`, `src/ui/MetricsBar.tsx`
- Modify: `ArchNode.tsx` (adds stats, the up/down badge, and queue cells for `queue`/`dlq`/broker lanes, at most 12 cells plus "+N")
- Test: `tests/ui/packets.test.ts`

**Interfaces:**
- Produces:
  - `runtimeStore` (zustand): `{ playing: boolean; speed: number; stats: Record<NodeId, NodeStats>; states: Record<NodeId, unknown>; metrics: MetricsSnapshot }`.
  - `useSimulation()` returns `{ sim, play, pause, step, reset, setSpeed, runAction }` and works like this:
    - It holds a single `Simulation` built from `useEditor().graph` and calls `sim.setGraph` on every graph change.
    - A `requestAnimationFrame` loop calls `sim.advance(Math.min(realDt, 100) * speed)` while `playing`.
    - `step` advances 100 ms.
    - `reset` builds a new `Simulation` and clears the packets.
    - Stats and states are flushed to the store at most once per frame.
  - `const SPEEDS = [0.25, 0.5, 1, 2, 4]`. The `-`/`+` keys step through them and Space toggles play.
  - `PacketLayer` (inside `ViewportPortal`) behaves like this:
    - It listens to `message:sent` and keeps packets of the form `{ msg, from, to, start: at, duration }`.
    - Each frame it positions packets at `cubicPoint(edgePoint(...), easeInOut((sim.now - start)/duration))`. Because this reads sim time, pausing freezes the packets.
    - Shapes depend on `msg.kind`:
      - request: circle
      - message: square
      - event: diamond
      - response: circle colored `ok` or `err` by status
    - Event colors come from `CLIENT_COLORS` indexed by a hash of `eventType`.
    - `MAX_PACKETS = 300`; the oldest packets are evicted first.
  - `FloatingLabels` shows a label for every `message:dropped` (the code, or else the reason, in `err`), every response with code 202 (`'202'` in `ok`), and every `node:label`. Each label floats up and fades over 1 s.
  - `Toolbar`:
    - "▶ Play" / "⏸ Pausa", "Paso", "Reset"
    - speed `1x`
    - "Presets" dropdown (calls `loadGraph` and then `reset`)
    - "Deshacer" / "Rehacer"
    - "Exportar" (downloads `arquitectura.json`), "Importar" (file input; on error it shows `parseGraph`'s message), "Copiar link" (`encodeHash` into the clipboard and a toast "Link copiado")
    - On mobile, only Play/Pausa, Reset and Presets.
  - `MetricsBar` shows "Throughput X req/s · p50 X ms · p95 X ms · Errores X%".

- [ ] **Step 1: Write failing tests**, with packet bookkeeping extracted into a pure `packetsReducer` in `PacketLayer.tsx`:
  - more than 300 sends keeps exactly 300, newest first
  - packets past `start + duration` are removed
  - `shapeFor(kind)` returns the mapping above
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the runtime, packet layer, labels, toolbar and metrics bar.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS. Then verify by hand in `npm run dev` with each of the 4 presets:
  - packets flow along the edges
  - pause freezes them
  - speed changes them
  - turning a server down with health checks off shows red `503`s
  - adding a worker while running takes load
  - export → import restores the graph
  - the copied link opens the same graph in a new tab
  - with `?mobile=1` the editing UI is hidden
- [ ] **Step 5: Commit** with message `feat: live simulation, packet animation and metrics`.

### Task 19: Deploy to GitHub Pages

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md` (Spanish: what it is, how to run it, how to add a component type using `defineComponent` with an example, a link to the spec)

**Interfaces:**
- The workflow runs on push to `main` and on `workflow_dispatch`, with permissions `pages: write` and `id-token: write`. Its steps:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with node 20 and npm cache
  3. `npm ci`
  4. `npm test`
  5. `npm run build`
  6. `actions/configure-pages@v5`
  7. `actions/upload-pages-artifact@v3` with path `dist`
  8. `actions/deploy-pages@v4`

- [ ] **Step 1: Write** the workflow and the README.
- [ ] **Step 2: Run** `npm ci && npm test && npm run build && npx vite preview --base /architecture-playground/`. Expected: the app loads at `http://localhost:4173/architecture-playground/`.
- [ ] **Step 3: Commit** with message `chore: github pages deploy workflow and readme`.
- [ ] **Step 4: ASK THE USER before running** `gh repo create gastonprieto/architecture-playground --public --source . --push`, then `gh api -X POST repos/gastonprieto/architecture-playground/pages -f build_type=workflow`. Once approved, run them and confirm that the Actions run passes and that `https://gastonprieto.github.io/architecture-playground/` loads.
