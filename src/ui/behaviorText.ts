import type { BehaviorStatus, DslError } from '../components/behavior'
import { defaultRegistry } from '../components/index'
import { lookup, translate, type Lang } from '../i18n'
import { componentLabel } from '../i18n/componentText'

/*
 * UI texts of the behavior DSL. The parser and validator report codes plus params; they are only
 * turned into words here. DSL keywords stay in English in both languages.
 */

/** The translated message of a DSL error, with its params filled in (a component type shown by its label). */
export function dslErrorText(lang: Lang, err: DslError): string {
  const params = { ...err.params }
  if (typeof params.type === 'string') params.type = componentLabel(lang, params.type, defaultRegistry.get(params.type))
  const key = err.code === 'wrong-verb' && params.suggestion !== undefined ? 'wrong-verb-suggestion' : err.code
  return translate(lang, `behavior.errors.${key}`, params)
}

/** `línea N: mensaje`. */
export const dslErrorLine = (lang: Lang, err: DslError): string =>
  translate(lang, 'behavior.line', { line: err.line, message: dslErrorText(lang, err) })

/** Inspector summary: "Por defecto", "2 handlers" or "⚠ 1 error". */
export function behaviorSummary(lang: Lang, status: BehaviorStatus): string {
  if (status.kind === 'default') return translate(lang, 'behavior.summary.default')
  const n = status.kind === 'active' ? status.handlers : status.errors.length
  const base = status.kind === 'active' ? 'handlers' : 'errors'
  return translate(lang, `behavior.summary.${base}${n === 1 ? 'One' : 'Other'}`, { n })
}

/** The "Insertar ejemplo" template for a component type (the service's one for other types). */
export const behaviorExample = (lang: Lang, type: string): string =>
  lookup(lang, `behavior.examples.${type}`) ?? translate(lang, 'behavior.examples.service')

const REFERENCE_KEYS = [
  'onRequest',
  'onEvent',
  'onMessage',
  'call',
  'query',
  'enqueue',
  'publish',
  'parallel',
  'wait',
  'fail',
  'reply',
  'nowait',
  'orReply',
  'orContinue',
] as const

/** Keyword table of the reference: English syntax (placeholders translated) and what it does. */
export const referenceRows = (lang: Lang): { key: string; syntax: string; text: string }[] =>
  REFERENCE_KEYS.map((key) => ({
    key,
    syntax: translate(lang, `behavior.ref.rows.${key}.syntax`),
    text: translate(lang, `behavior.ref.rows.${key}.text`),
  }))
