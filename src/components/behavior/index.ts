import type { BehaviorOutput, DslError, Program } from './ast'
import { parseBehavior } from './parse'
import { validateBehavior } from './validate'

export type { BehaviorOutput, DslError, DslErrorCode, Handler, Mod, Program, Step } from './ast'
export { parseBehavior } from './parse'
export { validateBehavior } from './validate'

/** Parse + validate. Errors from both, ordered by line (stable). */
export function compileBehavior(text: string, outputs: BehaviorOutput[]): { program: Program; errors: DslError[] } {
  const { program, errors } = parseBehavior(text)
  const all = [...errors, ...validateBehavior(program, outputs)].sort((a, b) => a.line - b.line)
  return { program, errors: all }
}
