# Architecture Playground

[Versión en español](README.md)

A playground to build architectures on a canvas (clients, services, databases, load balancers, reverse proxies, caches, queues, workers, DLQs, brokers and subscribers) and watch requests, messages and events flow between them. Tweak each component (capacity, processing time, outages, etc.) to see how the system behaves under load.

It comes with 7 presets:

- **Load Balancer**: two clients spread their traffic across three servers with round robin.
- **Sessions**: the session in the server's memory (constant 401s behind a round robin), in a shared key-value store and in a JWT, side by side.
- **Sync vs queue**: the same traffic against a synchronous service (it saturates with 503s) and against a queue with workers (it answers 202).
- **Pub/sub**: an event is published to the broker and reaches four subscribers; one is slow and falls behind.
- **Reverse Proxy**: the proxy routes each path prefix to its service, stops the client with no credentials with a 401 and caches `/static` at the edge.
- **Cache**: cache-aside; the service asks the Cache for each product and goes to the database on a MISS. With 10 products and room for 5, you see the evictions (LRU) and the database load.
- **Purchase order**: the same purchase orchestrated (Orders calls each service and waits) and choreographed (Orders publishes an event and each service reacts on its own), built with the behavior DSL.

A Client sends to its first output (the first edge connected from it).

The UI is in Spanish and English: the `ES | EN` switch in the toolbar changes the language instantly (so does `?lang=es` / `?lang=en` in the URL). With no saved choice, the browser language is used. Presets load in the current language; node names in graphs you already built are not translated.

Online (once the repo is published): https://gastonprieto.github.io/architecture-playground/

## Behavior (DSL)

Service, Worker and Subscriber have a **Behavior** field: a short text that decides what the node does with each request, event or message (whom it calls, in what order, what it publishes and which code it responds with). Empty or with errors, the node keeps its default behavior. Edit it from the inspector ("Edit behavior"); nodes that use it show a `DSL` badge. Keywords are English in both languages. Targets are referenced by the name of a connected node; the example below is illustrative and uses generic Spanish node names (Base de datos, Stock, Pagos, Mails, Facturas), so it only validates on a node wired to nodes with those names and to a Broker:

```
on request /ordenes:
  query Base de datos
  parallel:
    call Stock /reservas
    call Pagos /cobros or reply 402
  call Mails /enviar nowait
  publish OrdenCreada
  enqueue Facturas
  reply 201

on request:
  reply 404

on event PagoRechazado:
  call Stock /liberar or continue

on message:
  fail 10%
  query Base de datos
```

The full reference (in Spanish) is in [docs/dsl-spec.md](docs/dsl-spec.md).

## Sessions and auth

You can show where a user's session lives and who authenticates:

- **Client**: has **Users** (each with its own cookie) and **Authentication** (with login or no credentials). With more than one user, the node shows 🍪 logged-in/N.
- **`session` DSL step**: `session memory` (on the server), `session <Database>` (in a shared database) or `session jwt` (in the token, which cannot be revoked). A cookie the server does not know gets a `401` and the user logs in again.
- **Database**: has a **Type** (relational, key-value or document). Key-value is fast but volatile: if it restarts, it loses the sessions.
- **Load Balancer**: **Sticky sessions** sends each user to the server that gave it the cookie.
- **Reverse Proxy**: **Authentication** (none, credentials or JWT) stops whoever comes without credentials at the door with a `401`.

The **Sessions** preset puts the three cases side by side. The spec (in Spanish) is in [docs/sessions-spec.md](docs/sessions-spec.md).

## Cache

- **Cache**: with no outputs it is a **cache-aside** cache (the service asks it and, after a MISS, goes to the database and stores the key); with outputs it is **read-through**. **Mode** Real keys (Capacity with LRU eviction, and TTL) or Random (Hit rate). The node shows 🔑 keys and hit %.
- **Service**: wired to a Cache with no outputs, it does cache-aside automatically, no DSL needed.
- **`cache X:` DSL step**: the block runs only on a MISS and, if it goes well, the key is stored without waiting.
- **Reverse Proxy**: an edge cache (Off, Random or Real keys) only for the **Cacheable paths** (empty = all).

The spec (in Spanish) is in [docs/cache-spec.md](docs/cache-spec.md).

## Flow only

The **Real load | Flow only** switch in the metrics bar shows where traffic goes without fighting capacity: nothing saturates or fails by chance (capacity, waiting clients, max queue, rate limit, fail rate and the DSL's `fail N%` have no effect). Only a component that is **off** cuts a flow, or the flow's own logic (routes, sessions, auth). Turning it on or off starts the counters over. It does not change the saved configuration.

## Running it

```bash
npm install
npm run dev      # dev server
npm test         # tests (vitest; requires Node >= 22.22.2)
npm run build    # production build in dist/
```

## Adding a component type

Each component is a definition created with `defineComponent` in `src/components/`. Register it in the `builtins` list of `src/components/index.ts` (which feeds `defaultRegistry`). `defineComponent` adds the `name` field automatically, and the `config` fields show up in the properties panel on their own. The Spanish README has a full `rate-limiter` example.

The def's texts (`label`, field, option and action labels) are the fallback. To translate them, add keys to `src/i18n/es.ts` and `src/i18n/en.ts` (both must have the same keys; the `Dict` type checks it):

```ts
'rate-limiter': {
  label: 'Rate limiter',
  fields: { maxPerSecond: 'Max per second' },
},
```

`name`, `up`, `processingTime`, `capacity` and `queueMax` already have shared keys (`fields.<key>`). Drop reasons and `label` texts are stable English codes (`'queue-full'`, `'retry'`); the UI looks up `reasons.<code>` / `labels.<code>` and shows the raw code when there is none.

### The `ctx` API

- `send(target, msg)`: send a message to another node (adds this node to the `trail`).
- `reply(msg, { status, code })`: answer the message's origin.
- `forwardResponse(res)`: pass a response one hop further back.
- `drop(msg, reason, code?)`: drop the message (and send an error response back to its sender). `reason` is a code (`'down'`, `'queue-full'`, `'no-output'`…).
- `process(msg, done)`: hold a capacity slot for `processingTime`, then call `done` (queues or rejects when full).
- `schedule(ms, fn)`: run `fn` after `ms` of simulated time.
- `label(text, tone)`: show a floating label over the node (`text` is a code, e.g. `'retry'`, or a literal such as `'HIT'`).
- `random()`: the engine's deterministic random number.
- `outputs()`: the node's outgoing edges (`edgeId`, `target`, `targetType`, `rule`).
- `inputs()`: the node's incoming edges (`edgeId`, `source`, `sourceType`). A consumer uses them to know which queue/broker to ask for work.
- `pull(source)`: pull the next message from an upstream (queue/broker): sends a `poll` hop to `source`. The upstream answers in its `onPoll`, handing over a message if it has one.
- `freeSlots()`: processing slots free right now (`capacity − inFlight`), so a consumer only pulls what it can take.
- `flowOnly`: `true` in flow-only mode; a component with its own random failures should not fail.
- `peer(id)`: another node's type and config.
- `newMessage(kind, meta, parent?)`: create a new message.

Besides `onMessage`/`onResponse`, a component can define `onPoll(msg, ctx)`: the engine calls it when a consumer `pull`s from it (the queue and broker hand over one message per request there, instead of pushing).

`ctx.nodeId`, `ctx.now`, `ctx.config` and `ctx.state` are also available.

## Specification

The full design (in Spanish) is in [docs/spec.md](docs/spec.md); the behavior DSL, in [docs/dsl-spec.md](docs/dsl-spec.md).

## Deploy

The `.github/workflows/deploy.yml` workflow runs the tests, builds and publishes `dist/` to GitHub Pages on every push to `main`.
