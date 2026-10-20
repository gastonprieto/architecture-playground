# Architecture Playground

[Versión en español](README.md)

A playground to build architectures on a canvas (clients, services, databases, load balancers, reverse proxies, caches, queues, workers, DLQs, brokers and subscribers) and watch requests, messages and events flow between them. Tweak each component (capacity, processing time, outages, etc.) to see how the system behaves under load.

It comes with 4 presets:

- **Load balancer**: two clients spread their traffic across three servers with round robin.
- **Sync vs queue**: the same traffic against a synchronous service (it saturates with 503s) and against a queue with workers (it answers 202).
- **Pub/sub**: an event is published to the broker and reaches four subscribers; one is slow and falls behind.
- **Reverse proxy**: the proxy routes each path prefix to its service.

A Client sends to its first output (the first edge connected from it).

The UI is in Spanish and English: the `ES | EN` switch in the toolbar changes the language instantly (so does `?lang=es` / `?lang=en` in the URL). With no saved choice, the browser language is used. Presets load in the current language; node names in graphs you already built are not translated.

Online (once the repo is published): https://gastonprieto.github.io/architecture-playground/

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
- `peer(id)`: another node's type and config.
- `newMessage(kind, meta, parent?)`: create a new message.

`ctx.nodeId`, `ctx.now`, `ctx.config` and `ctx.state` are also available.

## Specification

The full design (in Spanish) is in [docs/spec.md](docs/spec.md).

## Deploy

The `.github/workflows/deploy.yml` workflow runs the tests, builds and publishes `dist/` to GitHub Pages on every push to `main`.
