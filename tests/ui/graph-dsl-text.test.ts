import { describe, expect, it } from 'vitest'
import { LANGS, lookup } from '../../src/i18n'
import { GRAPH_DSL_ERROR_CODES } from '../../src/persistence/dsl/errors'
import { graphDslErrorLine } from '../../src/ui/graphDslText'

describe('graphDslErrorLine', () => {
  it('formats the line, the message and the suggestion', () => {
    const err = { line: 2, code: 'unknown-type', params: { word: 'servise', suggestion: 'service' } } as const
    expect(graphDslErrorLine('es', err)).toBe('línea 2: "servise" no es un tipo, ¿quisiste decir "service"?')
    expect(graphDslErrorLine('en', err)).toBe('line 2: "servise" is not a type, did you mean "service"?')
  })

  it('appends the options of a bad value', () => {
    const err = { line: 3, code: 'bad-value', params: { key: 'algorithm', value: 'x', options: 'a, b' } } as const
    expect(graphDslErrorLine('es', err)).toContain('opciones: a, b')
    expect(graphDslErrorLine('en', err)).toContain('options: a, b')
  })

  it('has an es and en text for every code', () => {
    for (const lang of LANGS) {
      for (const code of GRAPH_DSL_ERROR_CODES) expect(lookup(lang, `graphDsl.errors.${code}`), `${lang} ${code}`).toBeTruthy()
    }
  })
})
