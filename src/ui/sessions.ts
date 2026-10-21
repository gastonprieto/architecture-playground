import { parseBehavior, type Step } from '../components/behavior'
import { userCount } from '../components/client'
import { DB_KIND_DEFAULTS, dbKind, type DbKind } from '../components/database'
import type { UiState } from './runtime/useSimulation'

/*
 * UI side of sessions (docs/sessions-spec.md §5, §9): the 🍪 counters and the database Tipo change.
 */

const hasMemory = (steps: Step[]): boolean =>
  steps.some((s) => (s.kind === 'session' && s.store.kind === 'memory') || (s.kind === 'parallel' && hasMemory(s.steps)))

/** Whether a behavior text has a `session memory` step (parse only: a typo elsewhere still counts). */
export function usesSessionMemory(text: unknown): boolean {
  if (typeof text !== 'string' || !text.includes('session')) return false
  return parseBehavior(text).program.handlers.some((h) => hasMemory(h.steps))
}

const BEHAVIOR_TYPES = new Set(['service', 'worker', 'subscriber'])

/**
 * The 🍪 counter of a node, or null when it shows none:
 * - Cliente: "🍪 logged/N" with login, or while some user still holds a cookie.
 * - Servicio, Worker, Suscriptor: "🍪 N" when the DSL keeps sessions in memory (or it still holds some).
 * - Base de datos: "🍪 N" while it holds sessions.
 */
export function cookieCounter(kind: string, config: Record<string, unknown>, ui: UiState | undefined): string | null {
  if (kind === 'client') {
    const logged = ui?.cookies ?? 0
    return config.auth !== 'none' || logged > 0 ? `🍪 ${logged}/${userCount(config as { users: number })}` : null
  }
  const n = ui?.sessions ?? 0
  if (kind === 'database') return n > 0 ? `🍪 ${n}` : null
  if (BEHAVIOR_TYPES.has(kind)) return n > 0 || usesSessionMemory(config.behavior) ? `🍪 ${n}` : null
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
