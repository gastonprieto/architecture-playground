# Cache-aside Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cache with real keys (LRU, TTL) or random mode, cache-aside by default (automatic in a plain Servicio, explicit with the DSL `cache X:` step), and a key-based edge cache in the Reverse Proxy restricted to cacheable paths, per `docs/cache-spec.md`.

**Spec:** `docs/cache-spec.md` (binding). Also `docs/spec.md`, `docs/dsl-spec.md`, `docs/sessions-spec.md`.

## Global Constraints

- English identifiers, comments and commits.
- All UI copy in es and en (`en` has exactly the `es` keys). Spanish keeps its accents.
- `src/engine` and `src/components` import nothing from `src/ui` or `src/i18n`. Deterministic: randomness only through `ctx.random()`.
- Backward compatible:
  - Old graphs with a Cache without `mode` and a proxy with `cacheHitRate` migrate per spec at every graph entry, using the existing `prepareGraph` in `src/ui/graphEntry.ts`.
  - A Servicio with no leaf Cache behaves exactly as today.
  - Every existing test stays green unless the spec changes that behavior; name any such test in the report.
- Commit trailer:

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EFgqKeRNmQJ1Lqt5ChLWCi

  Stage only `src/`, `tests/`, `docs/`, `README*.md`. Do not push.

## Review Focus

1. **LRU and TTL correctness.** Recency is updated on a get hit and on a set. Expired keys count as a miss and are removed. Capacity is never exceeded.
2. **Automatic cache-aside.** It must never write the key after a failed dependency, and a down cache must never fail the request.
3. **DSL `cache` block.** The `set` happens exactly once after a successful miss block. A `reply` inside the block ends the handler without setting. Every path releases the occupy slot.
4. **Migration idempotence** for Cache `mode` and proxy `cacheHitRate`.

---

### Task 1: Engine field features + Cache component

**Files:**
- `src/engine/registry.ts`: `Field` gains an optional `showIf?: { field: string; equals: string | boolean | number }`, plus a new kind `{ type: 'list'; label; default: string[] }`. `defaultConfig` copies arrays.
- `src/components/cache.ts`
- Tests: `tests/components/cache.test.ts`, `tests/engine/registry.test.ts`

**Interfaces:**
- **Cache config:**
  - `mode`: select `'keys' | 'random'`, default `'keys'`.
  - `capacity`: number 1–1000, default 50, `showIf` mode = keys.
  - `ttl`: number 0–600000 ms, default 0, `showIf` mode = keys.
  - `hitRate`: `showIf` mode = random.
  - `processingTime`: default 50.
  - `up`: boolean, default true.
- **Cache state:**
  - `keys: { key: string; at: number; used: number }[]` (or a Map serialized via counts for the UI).
  - `hits` and `misses` counters.
- **Behavior per spec §2:**
  - Leaf vs read-through is decided by `ctx.outputs().length`.
  - `cacheOp` `get` / `set`; no `cacheOp` means `get`.
  - Key resolution per spec.
  - Responses carry `meta.cacheHit`.
  - Labels `HIT` / `MISS`.
- **Exported pure helpers:** `cacheKeyOf(meta)` and an LRU/TTL store helper, so the proxy can reuse it.

- [ ] Write failing tests:
  - leaf get hit and miss
  - set then get hits
  - LRU eviction at capacity, where a get hit refreshes recency
  - TTL expiry using sim time
  - random mode unchanged and `set` is a no-op
  - read-through with outputs: a miss forwards, and the response stores the key in keys mode
  - down → 503
  - `showIf` and the `list` defaults
- [ ] Run RED, implement, run GREEN.
- [ ] Commit `feat(cache): leaf cache with real keys (LRU, TTL) or random mode`.

### Task 2: Automatic cache-aside in Servicio + DSL `cache X:` step

**Files:**
- `src/components/service.ts`, `src/components/shared/dependencies.ts` (if needed)
- `src/components/behavior/{ast,parse,validate,run}.ts`
- i18n error codes (es/en) for `cache-nowait`
- Tests: `tests/components/cache-aside.test.ts`, `tests/components/behavior/cache-step.test.ts`

**Interfaces:**
- **Default Servicio:** per spec §3. Leaf caches are outputs whose target is `cache` and has no outputs; use `ctx.peer` plus graph knowledge. If no API exposes a peer's outputs, add a minimal `ctx.peerOutputCount(id)` or carry the information another way, and justify it.
- **DSL:**
  - AST step: `{ kind: 'cache'; line; target; mod?; steps: Step[] }`.
  - Parsing follows the existing block steps (`parallel`).
  - Validation per spec §4.
  - Run semantics per spec §4.

- [ ] Write failing tests:
  - auto mode: hit skips the database; miss calls the database then sets; a database failure gives 502 with no set; a down cache is ignored (the database is still called) with no set; a service without a leaf cache is unchanged.
  - DSL: hit skips the block; miss runs the block then sets once; a failing step in the block gives 502 with no set; `reply` in the block ends without set; `or continue` with a down cache runs the block without set; validation errors (`not-connected`, `wrong-verb`, `empty-block`, `cache-nowait`); the slot is released on all paths.
- [ ] Run RED, implement, run GREEN.
- [ ] Commit `feat(cache): automatic cache-aside in Servicio and DSL cache step`.

### Task 3: Proxy edge cache + migration

**Files:**
- `src/components/reverse-proxy.ts`
- `src/ui/graphEntry.ts` (`migrateGraph`)
- Tests: `tests/components/reverse-proxy.test.ts`, migration tests

**Interfaces per spec §5:**
- **Config:**
  - `cache`: `'off' | 'random' | 'keys'`, default `'off'`.
  - `hitRate`: `showIf` cache = random.
  - `capacity` and `ttl`: `showIf` cache = keys.
  - `cacheablePaths`: `list`, default `['/static']`, `showIf` cache ≠ off. If `showIf` can only express equality, use a small `notEquals` variant or two conditions.
- **Keys mode:** store the key on an ok response, using the existing request-id tracking pattern from JWT issuance.
- **Migration:** `cacheHitRate > 0` becomes cache `random`, `hitRate` copied, `cacheablePaths: []` (all). Otherwise `cache: 'off'`. The old field is dropped. Idempotent.

- [ ] Write failing tests:
  - the cacheable-path filter, including empty = all
  - random mode
  - keys mode warm-up: first a miss that routes, then hits answered at the proxy
  - LRU and TTL
  - ordering preserved: rate limit → auth → cache → route
  - migration per entry path
- [ ] Run RED, implement, run GREEN.
- [ ] Commit `feat(proxy): edge cache with real keys and cacheable paths`.

### Task 4: UI + presets + docs

**Files:**
- `src/ui/Inspector.tsx` (honor `showIf`; render `list` fields with a rows editor like MixField without weight)
- `src/ui/canvas/ArchNode.tsx` (🔑 keys and hit % for Cache and keys-mode proxy)
- `src/ui/runtime/useSimulation.ts` (`uiCopy` / `uiSignature` counts)
- `src/i18n/es.ts`, `en.ts`: fields, options, info texts for Cache / Servicio / Proxy, DSL reference row for `cache X:`
- `src/presets/cache.ts` (new), `src/presets/reverse-proxy.ts`, `src/presets/index.ts`
- Docs: `docs/spec.md` (§5 rows, §7), `docs/dsl-spec.md` (`cache` step), `README*.md`
- Tests: jsdom and presets

**Presets per spec §7.** Test, 30 s at seed 1 with `withDemoTraffic`:
- The Cache preset's database receives far fewer requests than the client sends, and the cache's hit % rises over time.
- With capacity 10 the hit % is higher than with capacity 5.
- In the reverse-proxy preset only `/static` hits occur and Pagos is never answered by the proxy cache.

- [ ] Write failing tests, run RED, implement, run GREEN.
- [ ] Take screenshots (headless helper; dev server on port 5179), saved as `cache-*.png`:
  - the Cache inspector in each mode (ES)
  - the Cache preset running with counters
  - the proxy inspector with cacheable paths (EN)
- [ ] Commits:
  - `feat(ui): cache modes, conditional fields and key counters`
  - `feat(presets): cache-aside preset; edge cache in reverse proxy`
  - `docs: cache-aside`
