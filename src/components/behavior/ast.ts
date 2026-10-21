/** AST and error types of the behavior DSL (see docs/dsl-spec.md). Pure data, no UI or i18n. */

export type Mod = { kind: 'nowait' } | { kind: 'orReply'; code: number } | { kind: 'orContinue' }

export type Step =
  | { kind: 'call'; line: number; target: string; path: string; mod?: Mod }
  | { kind: 'query' | 'enqueue'; line: number; target: string; mod?: Mod }
  | { kind: 'publish'; line: number; eventType: string; mod?: Mod }
  | { kind: 'parallel'; line: number; steps: Step[] }
  | { kind: 'wait'; line: number; ms: number }
  /** `code` defaults to 500. */
  | { kind: 'fail'; line: number; percent: number; code: number }
  | { kind: 'reply'; line: number; code: number }
  /** Where the session lives (docs/sessions-spec.md §4). `mod` is never `nowait`. */
  | { kind: 'session'; line: number; store: SessionStore; mod?: Mod }

/** `memory` and `jwt` are keywords; any other target names a connected database. */
export type SessionStore = { kind: 'memory' } | { kind: 'jwt' } | { kind: 'database'; target: string }

export type Handler =
  | { on: 'request'; line: number; prefix?: string; steps: Step[] }
  | { on: 'event'; line: number; eventType?: string; steps: Step[] }
  | { on: 'message'; line: number; steps: Step[] }

export interface Program {
  handlers: Handler[]
}

export type DslErrorCode =
  | 'tab'
  | 'indent'
  | 'unknown-keyword'
  | 'missing-colon'
  | 'bad-number'
  | 'fail-range'
  | 'code-range'
  | 'call-missing-path'
  | 'missing-target'
  | 'step-outside-handler'
  | 'empty-block'
  | 'duplicate-handler'
  | 'not-connected'
  | 'ambiguous-target'
  | 'wrong-verb'
  | 'no-broker'
  | 'nowait-with-or'
  | 'session-nowait'

/** A code plus params; the UI translates it. `line` is 1-based. */
export interface DslError {
  line: number
  code: DslErrorCode
  params?: Record<string, string | number>
}

/** A connected output as the validator sees it: the target node's name and component type. */
export interface BehaviorOutput {
  name: string
  type: string
}
