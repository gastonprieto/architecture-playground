import type { Ctx } from '../../engine/registry'
import { matchesPath } from '../../engine/rules'
import type { Message, NodeId } from '../../engine/types'
import type { Handler, Mod, Program, Step } from './ast'
import { behaviorTargets, type BehaviorTarget } from './outputs'
import { parseBehavior } from './parse'
import { normalizeName, validateBehavior } from './validate'

/*
 * Interpreter of the behavior DSL (docs/dsl-spec.md §4–§6). A run executes one handler for one
 * message inside a capacity slot (ctx.occupy) and always ends with exactly one reply (or ack/nack),
 * then frees the slot. Child requests are tracked in the component state; their responses are
 * routed back through handleBehaviorResponse.
 */

export interface BehaviorConfig {
  behavior?: string
  /** Activo; `session memory` forgets every session while it is off. */
  up?: boolean
}

/** What to do with the response to a child request: `ok` is its status; `res` is absent when the target vanished. */
type ChildResult = (ok: boolean, res?: Message) => void

/** State a component must hold to run behaviors. */
export interface BehaviorState {
  /**
   * Child request id → the node it was sent to and its continuation (a no-op for `nowait`; ignored
   * once the handler ended).
   */
  behaviorPending: Record<string, { target: NodeId; next: ChildResult }>
  /** Last compile, keyed by the DSL text and the outputs it was validated against. */
  behaviorCache?: { key: string; program: Program | null }
  /** Session ids created by `session memory` (`sid:<id>`), in creation order, without duplicates. */
  sessions: string[]
}

export const initialBehaviorState = (): BehaviorState => ({ behaviorPending: {}, sessions: [] })

type BehaviorCtx = Ctx<BehaviorConfig, BehaviorState>

/** Connected outputs as the DSL sees them: one per target node (a node wired twice counts once). */
const targets = (ctx: BehaviorCtx): BehaviorTarget[] => behaviorTargets(ctx.outputs(), (id) => ctx.peer(id)?.config.name)

/**
 * The program to run for the next message, or null to keep the default behavior: when the DSL is
 * blank (no handlers) or has errors against the current outputs (e.g. a target renamed or
 * disconnected). Cached in the component state by text + outputs.
 */
export function activeProgram(ctx: BehaviorCtx): Program | null {
  const text = ctx.config.behavior
  if (typeof text !== 'string' || text.trim() === '') return null
  const outputs = targets(ctx).map(({ name, type }) => ({ name, type }))
  const key = JSON.stringify([text, outputs])
  const cached = ctx.state.behaviorCache
  if (cached?.key === key) return cached.program
  const { program, errors } = parseBehavior(text)
  const valid = errors.length === 0 && validateBehavior(program, outputs).length === 0 && program.handlers.length > 0
  ctx.state.behaviorCache = { key, program: valid ? program : null }
  return valid ? program : null
}

/**
 * If `res` answers a child request sent by a run, consumes it and returns true (a response for a
 * finished handler or a `nowait` child is consumed with no effect). Otherwise returns false.
 */
export function handleBehaviorResponse(res: Message, ctx: BehaviorCtx): boolean {
  const pending = ctx.state.behaviorPending
  const entry = res.replyTo === undefined ? undefined : pending[res.replyTo]
  if (entry) {
    delete pending[res.replyTo!]
    entry.next(res.status === 'ok', res)
  }
  sweepBehaviorPending(ctx)
  return entry !== undefined
}

/**
 * `session memory` lives in the process: while the component is Activo = off its sessions are gone.
 * Idempotent; components call it from onConfig (every edit, even paused) and onTick.
 */
export function forgetSessionsIfDown(ctx: BehaviorCtx): void {
  if (ctx.config.up === false && (ctx.state.sessions?.length ?? 0) > 0) ctx.state.sessions = []
}

/**
 * Fails every pending child whose target node no longer exists (it was deleted from the graph): its
 * response would never come, and the run would hold its capacity slot forever. Components call this
 * on every message, response and tick.
 */
export function sweepBehaviorPending(ctx: BehaviorCtx): void {
  const pending = ctx.state.behaviorPending
  for (const id of Object.keys(pending)) {
    const entry = pending[id]
    if (!entry || ctx.peer(entry.target)) continue
    delete pending[id]
    entry.next(false)
  }
}

interface Run {
  ctx: BehaviorCtx
  msg: Message
  finished: boolean
  done: () => void
  /** A session created by a `session` login; the final reply carries it (unless it is a 401). */
  setSession?: string
}

type AuthError = NonNullable<Message['meta']['authError']>

/** How a step or block ended without ending the handler: go on, or failed with no modifier (→ 502). */
type Outcome = 'next' | 'failed'

/**
 * Runs the handler of `program` that matches `msg` (spec §4). Ends with exactly one reply — 404 for an
 * unmatched request, ack for an unmatched event or message — then calls `done()`. `program` is the one
 * captured when the message arrived, so a DSL edit never changes a running handler.
 */
export function runBehavior(ctx: BehaviorCtx, program: Program, msg: Message, done: () => void): void {
  const run: Run = { ctx, msg, finished: false, done }
  const handler = selectHandler(program, msg)
  if (!handler) {
    end(run, msg.kind === 'request' ? 404 : 200)
    return
  }
  runSteps(run, handler.steps, 0, (outcome) => end(run, outcome === 'failed' ? 502 : 200))
}

function selectHandler(program: Program, msg: Message): Handler | undefined {
  const { handlers } = program
  if (msg.kind === 'request') {
    const path = msg.meta.path ?? ''
    let best: Handler | undefined
    let bestLen = -1
    for (const h of handlers) {
      if (h.on !== 'request') continue
      // Same rule as the Reverse Proxy: the longest matching prefix; no prefix is the default.
      const len = h.prefix === undefined ? 0 : matchesPath({ kind: 'pathPrefix', value: h.prefix }, path)
      if (len > bestLen) {
        best = h
        bestLen = len
      }
    }
    return best
  }
  if (msg.kind === 'event') {
    const type = (msg.meta.eventType ?? '').normalize('NFC')
    const events = handlers.filter((h) => h.on === 'event')
    return events.find((h) => h.eventType !== undefined && h.eventType.normalize('NFC') === type) ?? events.find((h) => h.eventType === undefined)
  }
  if (msg.kind === 'message') return handlers.find((h) => h.on === 'message')
  return undefined
}

/**
 * Replies once (`code < 400` is ok; for events and messages that is ack vs nack) and frees the slot.
 * A pending login rides on the reply as `setSession`, except on a 401.
 */
function end(run: Run, code: number, authError?: AuthError): void {
  if (run.finished) return
  run.finished = true
  const meta = authError ? { authError } : code !== 401 && run.setSession !== undefined ? { setSession: run.setSession } : undefined
  run.ctx.reply(run.msg, { status: code < 400 ? 'ok' : 'error', code, ...(meta && { meta }) })
  run.done()
}

function runSteps(run: Run, steps: Step[], i: number, then: (o: Outcome) => void): void {
  if (run.finished) return
  if (i >= steps.length) {
    then('next')
    return
  }
  runStep(run, steps[i], (o) => {
    if (run.finished) return
    if (o === 'failed') then('failed')
    else runSteps(run, steps, i + 1, then)
  })
}

function runStep(run: Run, step: Step, then: (o: Outcome) => void): void {
  // A branch of a parallel block may have ended the handler synchronously (reply, fail).
  if (run.finished) return
  const { ctx, msg } = run
  switch (step.kind) {
    case 'call':
      childStep(run, step.mod, then, (send) => send(resolve(ctx, step.target), { ...msg.meta, path: step.path }))
      return
    case 'query':
    case 'enqueue':
      childStep(run, step.mod, then, (send) => send(resolve(ctx, step.target), { ...msg.meta }))
      return
    case 'publish':
      childStep(run, step.mod, then, (send) => {
        for (const b of targets(ctx)) if (b.type === 'broker') send(b.target, { ...msg.meta, eventType: step.eventType })
      })
      return
    case 'parallel': {
      let remaining = step.steps.length
      if (remaining === 0) {
        then('next')
        return
      }
      let failed = false
      for (const branch of step.steps) {
        runStep(run, branch, (o) => {
          if (o === 'failed') failed = true
          if (--remaining === 0) then(failed ? 'failed' : 'next')
        })
      }
      return
    }
    case 'wait':
      ctx.schedule(step.ms, () => then('next'))
      return
    case 'fail':
      if (ctx.random() * 100 < step.percent) end(run, step.code)
      else then('next')
      return
    case 'reply':
      end(run, step.code)
      return
    case 'session':
      sessionStep(run, step, then)
  }
}

/** Default status when a session store does not answer (down, queue full, gone). */
const STORE_FAILED = 503

/**
 * docs/sessions-spec.md §4. A valid cookie goes on; an unknown one (or one of another kind) is a 401
 * `session-lost`; credentials without a cookie log in (the final reply carries `setSession`); neither
 * is a 401 `unauthenticated`. Only a database store can fail, and then the modifier decides (503 by
 * default). Events and messages skip the step.
 */
function sessionStep(run: Run, step: Extract<Step, { kind: 'session' }>, then: (o: Outcome) => void): void {
  const { ctx, msg } = run
  if (msg.kind !== 'request') {
    then('next')
    return
  }
  const sid = msg.meta.sessionId
  const cookie = typeof sid === 'string' && sid !== '' ? sid : undefined
  if (cookie === undefined && msg.meta.credentials !== true) {
    end(run, 401, 'unauthenticated')
    return
  }
  const lost = () => end(run, 401, 'session-lost')
  const login = (id: string) => {
    run.setSession = id
    then('next')
  }
  const { store } = step
  if (store.kind === 'jwt') {
    // The signature is simulated and shared: any jwt: token is valid, anything else is not.
    if (cookie === undefined) login(`jwt:${msg.id}`)
    else if (cookie.startsWith('jwt:')) then('next')
    else lost()
    return
  }
  if (store.kind === 'memory') {
    const sessions = (ctx.state.sessions ??= [])
    if (cookie !== undefined) {
      if (sessions.includes(cookie)) then('next')
      else lost()
      return
    }
    const id = `sid:${msg.id}`
    // A component that is off keeps nothing in memory (forgetSessionsIfDown).
    if (ctx.config.up !== false && !sessions.includes(id)) sessions.push(id)
    login(id)
    return
  }
  const failed = () => {
    if (step.mod?.kind === 'orContinue') then('next')
    else if (step.mod?.kind === 'orReply') end(run, step.mod.code)
    else end(run, STORE_FAILED)
  }
  const target = resolve(ctx, store.target)
  if (target === undefined) {
    failed()
    return
  }
  const id = cookie ?? `sid:${msg.id}`
  const child = ctx.newMessage('request', { ...msg.meta, sessionOp: cookie === undefined ? 'create' : 'check', sessionId: id }, msg)
  ctx.state.behaviorPending[child.id] = {
    target,
    next: (_ok, res) => {
      if (run.finished) return
      if (res?.code === 200) {
        if (cookie === undefined) login(id)
        else then('next')
      } else if (res?.code === 404 && cookie !== undefined) lost()
      else failed()
    },
  }
  ctx.send(target, child)
}

/** The connected node named `name`, or undefined when it is gone, renamed or ambiguous. */
function resolve(ctx: BehaviorCtx, name: string): NodeId | undefined {
  const wanted = normalizeName(name)
  const matches = targets(ctx).filter((t) => normalizeName(t.name) === wanted)
  return matches.length === 1 ? matches[0].target : undefined
}

/** Sends one child request to `target`; an undefined target (gone, renamed, ambiguous) counts as a failure. */
type Send = (target: NodeId | undefined, meta: Message['meta']) => void

/**
 * A step that sends child requests (one, or one per broker). It waits for all of them unless
 * `nowait`; sending to nobody counts as failed. The modifier decides what a failure does.
 */
function childStep(run: Run, mod: Mod | undefined, then: (o: Outcome) => void, sendAll: (send: Send) => void): void {
  const { ctx } = run
  const nowait = mod?.kind === 'nowait'
  let attempted = 0
  let remaining = 0
  let ok = true
  const finish = (allOk: boolean) => {
    if (run.finished) return
    if (allOk || mod?.kind === 'orContinue') then('next')
    else if (mod?.kind === 'orReply') end(run, mod.code)
    else then('failed')
  }
  // Responses always arrive later (at least one hop), so `remaining` is final before any settles.
  const settle = (childOk: boolean) => {
    if (!childOk) ok = false
    if (--remaining === 0) finish(ok)
  }
  sendAll((target, meta) => {
    attempted++
    if (target === undefined) {
      ok = false
      return
    }
    const child = ctx.newMessage('request', meta, run.msg)
    remaining++
    ctx.state.behaviorPending[child.id] = { target, next: nowait ? () => {} : settle }
    ctx.send(target, child)
  })
  if (nowait) then('next')
  else if (remaining === 0) finish(attempted > 0 && ok)
}
