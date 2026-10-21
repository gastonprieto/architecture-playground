# Behavior DSL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servicio, Worker and Suscriptor can be given a small text behavior (DSL) that decides what they do with each request, event or message.

**Architecture:**
- The DSL is parsed and validated by pure functions in `src/components/behavior/`, shared by the engine and the UI.
- An interpreter runs a handler through `ctx`, holding a capacity slot until the handler ends. The slot is held through a new engine primitive, `ctx.occupy`.
- The UI adds a `behavior` field kind, rendered as a summary plus an editor popup, and a badge on nodes.

**Tech Stack:** existing (TS, React, React Flow, zustand, Vitest, jsdom).

**Spec:** `docs/dsl-spec.md` (binding). Also `docs/spec.md` for the engine/components model.

## Global Constraints

- English identifiers, comments and commits. UI copy in es and en (`src/i18n`; `en` has exactly the `es` keys). Spanish keeps its accents.
- DSL keywords are English and the same in both languages: `on request|event|message`, `call`, `query`, `enqueue`, `publish`, `parallel`, `wait`, `fail`, `reply`, `nowait`, `or`, `continue`.
- `src/engine` and `src/components` import nothing from `src/ui` or `src/i18n`. DSL errors are codes plus params, translated only in the UI.
- Determinism: randomness only through `ctx.random()`.
- An empty `behavior` field must leave today's behavior unchanged. Every existing test stays green.
- Commit trailer:

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EFgqKeRNmQJ1Lqt5ChLWCi

  Stage only `src/`, `tests/`, `docs/`, `README*.md`. Do not push.

## Review Focus

1. **Responses to a finished handler.** These come from `nowait`, or from a handler that already replied while a parallel sibling is still outstanding. They must be ignored silently: no crash, no double reply, no forwarding to the original caller. Pinned in Task 3.
2. **DSL edited while requests are in flight.** In-flight handlers finish with the program they started with, and new arrivals use the new one. Pinned in Task 3.
3. **A target node renamed or disconnected after the DSL was written.** Validation flips to an error (badge appears), and the component falls back to its default behavior. Pinned in Task 3 and Task 4.
4. **Slot accounting.** `occupy` must release exactly once per handler, whatever path ends it: reply, end of handler, fail, step error, or node removed. Otherwise capacity leaks. Pinned in Task 1 and Task 3.
5. **Unreadable input.** CRLF line endings, tabs, trailing spaces, unicode names with accents and quoted names must all be handled. Pinned in Task 2.

---

### Task 1: Engine `ctx.occupy`

**Files:**
- Modify: `src/engine/processing.ts`, `src/engine/registry.ts` (Ctx), `src/engine/simulation.ts`
- Test: `tests/engine/processing.test.ts`

**Interfaces:**
- Produces: `ctx.occupy(msg: Message, run: (release: () => void) => void): void`.
  - Same admission rules as `process`: down → 503 `down`, full queue → 503 `queue-full`, otherwise run now or queue FIFO.
  - Waits `processingTime`, then calls `run(release)`. The slot stays in use until `release()` is called.
  - `release` is idempotent: a second call is a no-op.
  - If the node is removed while the job is held, release is harmless.

- [ ] Write failing tests:
  - capacity 1: a second `occupy` queues until the first calls `release`
  - `release` twice frees only once
  - stats `inFlight` and `queued` are emitted
  - down rejects
  - `process` unchanged: existing tests stay green
- [ ] Run RED, implement, run GREEN, run the full suite, commit `feat(engine): ctx.occupy holds a capacity slot until released`.

### Task 2: DSL parser and validator

**Files:**
- Create: `src/components/behavior/ast.ts`, `parse.ts`, `validate.ts`, `index.ts`
- Test: `tests/components/behavior/parse.test.ts`, `validate.test.ts`

**Interfaces (exact):**

```ts
type Mod = { kind: 'nowait' } | { kind: 'orReply'; code: number } | { kind: 'orContinue' }
type Step =
  | { kind: 'call'; line: number; target: string; path: string; mod?: Mod }
  | { kind: 'query' | 'enqueue'; line: number; target: string; mod?: Mod }
  | { kind: 'publish'; line: number; eventType: string; mod?: Mod }
  | { kind: 'parallel'; line: number; steps: Step[] }
  | { kind: 'wait'; line: number; ms: number }
  | { kind: 'fail'; line: number; percent: number; code: number }   // code default 500
  | { kind: 'reply'; line: number; code: number }
type Handler =
  | { on: 'request'; line: number; prefix?: string; steps: Step[] }
  | { on: 'event'; line: number; eventType?: string; steps: Step[] }
  | { on: 'message'; line: number; steps: Step[] }
interface Program { handlers: Handler[] }
type DslErrorCode =
  | 'tab' | 'indent' | 'unknown-keyword' | 'missing-colon' | 'bad-number' | 'fail-range' | 'code-range'
  | 'call-missing-path' | 'missing-target' | 'step-outside-handler' | 'empty-block' | 'duplicate-handler'
  | 'not-connected' | 'ambiguous-target' | 'wrong-verb' | 'no-broker' | 'nowait-with-or'
interface DslError { line: number; code: DslErrorCode; params?: Record<string, string | number> }
function parseBehavior(text: string): { program: Program; errors: DslError[] }
function validateBehavior(program: Program, outputs: { name: string; type: string }[]): DslError[]
function compileBehavior(text: string, outputs: { name: string; type: string }[]): { program: Program; errors: DslError[] }  // parse + validate
```

**Rules:**
- Grammar as in spec §3.
- Destination names are matched after trimming. They may be quoted with `"…"`, and they end at the first token starting with `/` or at the keywords `nowait` / `or`.
- Line numbers are 1-based. Normalize CRLF.
- `wrong-verb` carries `params.suggestion` (`'query' | 'call' | 'enqueue'`).
- Valid target types:
  - `call` → `service`, `load-balancer`, `reverse-proxy`
  - `query` → `database`, `cache`
  - `enqueue` → `queue`
  - `publish` needs ≥1 output of type `broker`

- [ ] Write failing tests:
  - spec §2 example parses to the expected AST, with no errors once outputs are provided
  - one test per error code, each asserting its line number
  - CRLF, tab, quoted name with spaces and accents ("Base de datos"), comment lines, `parallel` nesting
  - `fail 10% 503`
- [ ] Run RED, implement, run GREEN, commit `feat(dsl): behavior parser and validator`.

### Task 3: Interpreter and wiring into Servicio, Worker and Suscriptor

**Files:**
- Create: `src/components/behavior/run.ts`
- Modify: `src/engine/registry.ts` (new Field kind `{ type: 'behavior'; label; default: '' }`), `src/components/service.ts`, `worker.ts`, `subscriber.ts`
- Test: `tests/components/behavior/run.test.ts`

**Interfaces:**
- `behavior` config field: key `behavior`, label 'Comportamiento' (component def fallback text), default `''`.
- `activeProgram(ctx): Program | null`. Compiles `config.behavior` against `ctx.outputs()` mapped to `{ name: peer.config.name, type: targetType }`. Caches by text + outputs signature in component state. Returns null when the text is empty or has errors.
- `runBehavior(ctx, program, msg, done: () => void): void`. Selects the handler (spec §4) and executes the steps (spec §5). It always ends by replying, acking or nacking exactly once, then calls `done()`.
- `handleBehaviorResponse(res, ctx): boolean`. Consumes responses to the children it sent. Responses whose handler already finished, or that were sent `nowait`, are consumed and ignored.
- **In each of the three components:**
  - `onMessage`: if `activeProgram` is non-null, `ctx.occupy(msg, release => runBehavior(ctx, program, msg, release))`; otherwise the current behavior.
  - `onResponse`: try `handleBehaviorResponse` first, then the existing handling.
  - The program used is captured at start (Review Focus 2).

- [ ] Write failing engine-level tests (real `Simulation`, real components):
  - `call` → hop timing and reply 200 at the end
  - path is set on the child
  - `or reply 402`, `or continue`, and the default 502 on error
  - `nowait`: the handler replies before the child answers, and the late response is ignored
  - `query`
  - `enqueue` waits only for the 202
  - `publish` reaches the broker with `eventType`
  - `parallel` waits for all; the 502 comes after all finish
  - `wait` timing
  - `fail 100%` → 500, and nack for messages so the queue retries
  - `reply 201` ends the handler, and later steps don't run
  - no handler match → 404 for a request, ack for an event
  - `on event Tipo` selection
  - slot held across the whole handler (capacity 1: second request queued until the first finishes)
  - DSL with errors → default behavior
  - DSL changed mid-flight (Review Focus 2)
  - empty DSL → existing tests unchanged
  - `meta.clientColor` propagates to children
- [ ] Run RED, implement, run GREEN, commit `feat(dsl): interpreter for Servicio, Worker and Suscriptor`.

### Task 4: UI — behavior field, editor popup, node badge

**Files:**
- Create: `src/ui/fields/BehaviorField.tsx`, `src/ui/BehaviorEditor.tsx`, `src/ui/behaviorText.ts` (error and reference translation)
- Modify: `src/ui/Inspector.tsx`, `src/ui/canvas/ArchNode.tsx`, `src/i18n/es.ts`, `en.ts`, `src/ui/theme.css`, `src/ui/store/editor.ts` (if needed)
- Test: `tests/ui/behavior-editor.test.tsx`

**Behavior (spec §8):**
- **Inspector summary:** "Por defecto" / "N handlers" / "⚠ N errores", plus an "Editar comportamiento" button.
- **Popup:**
  - modal dialog, keyboard handled like InfoDialog (focus trap, Esc = cancel, app `inert`)
  - monospace textarea with a line-number gutter that stays aligned on scroll
  - live errors below, translated `línea N: …`, validated against the node's current outputs
  - "Insertar ejemplo" fills a template per component type when empty, or appends
  - reference panel (same content as the ⓘ DSL section)
  - Guardar (one undoable `updateNodeConfig`, bypassing keystroke coalescing) and Cancelar
- **Node badge:** "DSL" when the behavior is active, "⚠ DSL" when it has errors.
- **i18n:** every error code has a translated message using `params`; a reference section exists in both languages.
- **Info panel:** the Servicio, Worker and Suscriptor info texts mention the behavior.

- [ ] Write failing jsdom tests:
  - summary states
  - open popup, type a valid DSL, Guardar → config updated and one undo step
  - an invalid line shows "línea N" with the translated message
  - Esc cancels without saving
  - EN shows the English messages
  - badge rendering
- [ ] Run RED, implement, run GREEN.
- [ ] Take headless screenshots: the popup with errors (ES), the popup valid (EN), and nodes with badges. Use `node /private/tmp/claude-501/-Users-gaston-projects-personal/1f4c8f94-bec5-4867-a0b3-bfa2cf4012a0/scratchpad/shot.cjs …`; the dev server runs on port 5179.
- [ ] Commit `feat(ui): behavior editor popup and DSL badge`.

### Task 5: Preset "Orden de compra" and docs

**Files:**
- Create: `src/presets/purchase-order.ts`
- Modify: `src/presets/index.ts`, `src/i18n/es.ts`, `en.ts`, `docs/spec.md` (§5 rows for Servicio, Worker and Suscriptor, plus §7 presets), `README.md`, `README.en.md` (DSL section with the spec §2 example)
- Test: `tests/presets/presets.test.ts`

**Preset (spec §9):** two lanes in one graph, with names and DSL per language.
- **Orchestration lane:** Cliente → Órdenes, which calls Stock, Pagos and Mails (`nowait`). Each of these queries its own Base de datos.
- **Choreography lane:** Cliente → Órdenes, which does `query` + `publish OrdenCreada` + `reply 202`, then Broker → Stock, Pagos and Mails, each with `on event OrdenCreada` and its query.
- Every DSL in the preset must validate with zero errors in both languages; the test checks this.

- [ ] Write failing tests:
  - the preset's DSLs compile with no errors in es and en
  - after 30 s with seed 1, the orchestration client gets 201s and the choreography client gets 202s
  - each choreography subscriber processed events
- [ ] Run RED, implement, run GREEN.
- [ ] Take a screenshot of the preset running.
- [ ] Commit `feat(presets): purchase order — orchestration vs choreography`.
