import { parseBehavior, type Step } from '../components/behavior'
import { userCount } from '../components/client'
import { DB_KIND_DEFAULTS, dbKind, type DbKind } from '../components/database'
import type { UiState } from './runtime/useSimulation'

/*
 * UI side of sessions (docs/sessions-spec.md §5, §9): the 🍪 counters and the database Tipo change.
 */

const hasMemory = (steps: Step[]): boolean =>
  steps.some((s) => (s.kind === 'session' && s.store.kind === 'memory') || ((s.kind === 'parallel' || s.kind === 'cache') && hasMemory(s.steps)))

/** Parsed answers per behavior text; cleared when it grows past MEMO_MAX (texts are edited, not many). */
const memo = new Map<string, boolean>()
const MEMO_MAX = 200

/** Whether a behavior text has a `session memory` step (parse only: a typo elsewhere still counts). Memoized. */
export function usesSessionMemory(text: unknown): boolean {
  if (typeof text !== 'string' || !text.includes('session')) return false
  const known = memo.get(text)
  if (known !== undefined) return known
  const found = parseBehavior(text).program.handlers.some((h) => hasMemory(h.steps))
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(text, found)
  return found
}

/**
 * The 🍪 counter of a node, or null when it shows none:
 * - Cliente: "🍪 logged/N" when it has more than one user, or while some user holds a cookie.
 * - Servicio: "🍪 N" when the DSL keeps sessions in memory (or it still holds some). Workers and
 *   subscribers never serve requests, so they never hold sessions.
 * - Base de datos: "🍪 N" while it holds sessions.
 */
export function cookieCounter(kind: string, config: Record<string, unknown>, ui: UiState | undefined): string | null {
  if (kind === 'client') {
    const logged = ui?.cookies ?? 0
    const users = userCount(config as { users: number })
    return logged > 0 || users > 1 ? `🍪 ${logged}/${users}` : null
  }
  const n = ui?.sessions ?? 0
  if (kind === 'database') return n > 0 ? `🍪 ${n}` : null
  if (kind === 'service') return n > 0 || usesSessionMemory(config.behavior) ? `🍪 ${n}` : null
  return null
}

/**
 * The config patch for a database Tipo change: the new kind plus its suggested processingTime, unless
 * the current processingTime was customized (it differs from the previous kind's suggestion).
 */
export function databaseKindPatch(config: Record<string, unknown>, kind: DbKind): Record<string, unknown> {
  const prev = DB_KIND_DEFAULTS[dbKind(config as { kind?: DbKind })].processingTime
  const current = typeof config.processingTime === 'number' ? config.processingTime : DB_KIND_DEFAULTS.relational.processingTime
  return current === prev ? { kind, processingTime: DB_KIND_DEFAULTS[kind].processingTime } : { kind }
}
