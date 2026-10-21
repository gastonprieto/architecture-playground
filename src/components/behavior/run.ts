import type { Ctx } from '../../engine/registry'
import { matchesPath } from '../../engine/rules'
import type { Message, NodeId } from '../../engine/types'
import type { BehaviorOutput, Handler, Mod, Program, Step } from './ast'
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
}

/** What to do with the response to a child request: `ok` is its status. */
type ChildResult = (ok: boolean) => void

/** State a component must hold to run behaviors. */
export interface BehaviorState {
  /** Child request id → its continuation (a no-op for `nowait`; ignored once the handler ended). */
  behaviorPending: Record<string, ChildResult>
  /** Last compile, keyed by the DSL text and the outputs it was validated against. */
  behaviorCache?: { key: string; program: Program | null }
}

export const initialBehaviorState = (): BehaviorState => ({ behaviorPending: {} })

type BehaviorCtx = Ctx<BehaviorConfig, BehaviorState>

interface Target extends BehaviorOutput {
  target: NodeId
}

/** Connected outputs as the DSL sees them: one per target node (a node wired twice counts once). */
function targets(ctx: BehaviorCtx): Target[] {
  const seen = new Set<NodeId>()
  const list: Target[] = []
  for (const out of ctx.outputs()) {
    if (seen.has(out.target)) continue
    seen.add(out.target)
    const name = ctx.peer(out.target)?.config.name
    list.push({ target: out.target, type: out.targetType, name: typeof name === 'string' ? name.trim() : '' })
  }
  return list
}

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
  const next = res.replyTo === undefined ? undefined : pending?.[res.replyTo]
  if (!next) return false
  delete pending[res.replyTo!]
  next(res.status === 'ok')
  return true
}

interface Run {
  ctx: BehaviorCtx
  msg: Message
  finished: boolean
  done: () => void
}

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

/** Replies once (`code < 400` is ok; for events and messages that is ack vs nack) and frees the slot. */
function end(run: Run, code: number): void {
  if (run.finished) return
  run.finished = true
  run.ctx.reply(run.msg, { status: code < 400 ? 'ok' : 'error', code })
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
  }
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
    ctx.state.behaviorPending[child.id] = nowait ? () => {} : settle
    ctx.send(target, child)
  })
  if (nowait) then('next')
  else if (remaining === 0) finish(attempted > 0 && ok)
}
