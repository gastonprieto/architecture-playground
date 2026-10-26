import { translate, type Lang } from '../i18n'
import type { GraphDslError } from '../persistence/dsl'

/** `línea N: mensaje`, plus the bad-value options and the "did you mean" when the parser found them. */
export function graphDslErrorLine(lang: Lang, err: GraphDslError): string {
  const params = err.params ?? {}
  let message = translate(lang, `graphDsl.errors.${err.code}`, params)
  if (params.options !== undefined) message += `; ${translate(lang, 'graphDsl.options', params)}`
  if (params.suggestion !== undefined) message += `, ${translate(lang, 'graphDsl.didYouMean', params)}`
  return translate(lang, 'graphDsl.line', { line: err.line, message })
}
