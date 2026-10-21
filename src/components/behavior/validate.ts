import type { BehaviorOutput, DslError, Program, Step } from './ast'

/** Component types each verb may target. `publish` instead needs at least one connected broker. */
const TARGET_TYPES = {
  call: ['service', 'load-balancer', 'reverse-proxy'],
  query: ['database', 'cache'],
  enqueue: ['queue'],
} as const

type TargetVerb = keyof typeof TARGET_TYPES

/** `session <name>` may only target a database (memory and jwt need no output). */
const SESSION_TYPES = ['database'] as const

/** `cache <name>:` may only target a Cache. */
const CACHE_TYPES = ['cache'] as const

/**
 * Names compare after NFC normalization (an accent typed decomposed matches a composed one), trimming
 * and collapsing inner whitespace (the parser joins words with one space).
 */
export const normalizeName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ')

/** Pure check of a parsed program against the node's connected outputs. */
export function validateBehavior(program: Program, outputs: BehaviorOutput[]): DslError[] {
  const errors: DslError[] = []
  const hasBroker = outputs.some((o) => o.type === 'broker')

  const seen = new Set<string>()
  for (const h of program.handlers) {
    const key = `${h.on} ${h.on === 'request' ? (h.prefix ?? '') : h.on === 'event' ? (h.eventType ?? '').normalize('NFC') : ''}`
    if (seen.has(key)) errors.push({ line: h.line, code: 'duplicate-handler', params: { on: h.on } })
    seen.add(key)
    checkSteps(h.steps)
  }
  return errors

  function checkSteps(steps: Step[]): void {
    for (const step of steps) {
      if (step.kind === 'parallel') checkSteps(step.steps)
      else if (step.kind === 'cache') {
        checkTarget('cache', step.target, step.line)
        checkSteps(step.steps)
      } else if (step.kind === 'publish') {
        if (!hasBroker) errors.push({ line: step.line, code: 'no-broker' })
      } else if (step.kind === 'call' || step.kind === 'query' || step.kind === 'enqueue') {
        checkTarget(step.kind, step.target, step.line)
      } else if (step.kind === 'session' && step.store.kind === 'database') {
        checkTarget('session', step.store.target, step.line)
      }
    }
  }

  function checkTarget(verb: TargetVerb | 'session' | 'cache', target: string, line: number): void {
    const name = normalizeName(target)
    const matches = outputs.filter((o) => normalizeName(o.name) === name)
    if (matches.length === 0) {
      errors.push({ line, code: 'not-connected', params: { target: name } })
    } else if (matches.length > 1) {
      errors.push({ line, code: 'ambiguous-target', params: { target: name } })
    } else {
      const type = matches[0].type
      const allowed: readonly string[] = verb === 'session' ? SESSION_TYPES : verb === 'cache' ? CACHE_TYPES : TARGET_TYPES[verb]
      if (allowed.includes(type)) return
      // A broker is reached with `publish` (it takes the event type, not the broker's name).
      const suggestion =
        type === 'broker' ? 'publish' : (Object.keys(TARGET_TYPES) as TargetVerb[]).find((v) => (TARGET_TYPES[v] as readonly string[]).includes(type))
      errors.push({ line, code: 'wrong-verb', params: { verb, target: name, type, ...(suggestion && { suggestion }) } })
    }
  }
}
