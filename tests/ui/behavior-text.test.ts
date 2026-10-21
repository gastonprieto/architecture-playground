import { describe, expect, it } from 'vitest'
import { behaviorStatus, compileBehavior, type DslError, type DslErrorCode } from '../../src/components/behavior'
import { behaviorExample, behaviorSummary, dslErrorLine, dslErrorText, referenceRows } from '../../src/ui/behaviorText'

/** One sample error per code, with the params the parser/validator produce. */
const SAMPLES: Record<DslErrorCode, DslError> = {
  tab: { line: 1, code: 'tab' },
  indent: { line: 1, code: 'indent' },
  'unknown-keyword': { line: 1, code: 'unknown-keyword', params: { word: 'cal' } },
  'missing-colon': { line: 1, code: 'missing-colon' },
  'bad-number': { line: 1, code: 'bad-number', params: { value: 'diez' } },
  'fail-range': { line: 1, code: 'fail-range', params: { value: 120 } },
  'code-range': { line: 1, code: 'code-range', params: { value: 700 } },
  'call-missing-path': { line: 1, code: 'call-missing-path', params: { target: 'Pagos' } },
  'missing-target': { line: 1, code: 'missing-target' },
  'step-outside-handler': { line: 1, code: 'step-outside-handler' },
  'empty-block': { line: 1, code: 'empty-block' },
  'duplicate-handler': { line: 1, code: 'duplicate-handler', params: { on: 'request' } },
  'not-connected': { line: 1, code: 'not-connected', params: { target: 'Pagos' } },
  'ambiguous-target': { line: 1, code: 'ambiguous-target', params: { target: 'Pagos' } },
  'wrong-verb': { line: 1, code: 'wrong-verb', params: { verb: 'call', target: 'BD', type: 'database', suggestion: 'query' } },
  'no-broker': { line: 1, code: 'no-broker' },
  'nowait-with-or': { line: 1, code: 'nowait-with-or' },
  'session-nowait': { line: 1, code: 'session-nowait' },
}

describe('dslErrorText', () => {
  it('every code has a translated message in both languages, with its params filled in', () => {
    for (const err of Object.values(SAMPLES)) {
      const es = dslErrorText('es', err)
      const en = dslErrorText('en', err)
      for (const text of [es, en]) {
        expect(text, err.code).not.toMatch(/[{}]/)
        expect(text, err.code).not.toContain('behavior.errors')
        for (const v of Object.values(err.params ?? {})) if (typeof v !== 'string' || !['request', 'database', 'call', 'query'].includes(v)) expect(text).toContain(String(v))
      }
      expect(es, err.code).not.toBe(en)
    }
  })

  it('reads like the spec', () => {
    expect(dslErrorText('es', SAMPLES['not-connected'])).toBe('"Pagos" no está conectado')
    expect(dslErrorText('en', SAMPLES['not-connected'])).toBe('"Pagos" is not connected')
    expect(dslErrorText('es', SAMPLES['wrong-verb'])).toBe('call no va con "BD" (Base de datos); ¿quisiste decir query?')
    expect(dslErrorText('en', SAMPLES['wrong-verb'])).toBe('call does not work with "BD" (Database); did you mean query?')
    expect(dslErrorText('es', SAMPLES['duplicate-handler'])).toContain('on request')
  })

  it('wrong-verb without a suggestion has no question', () => {
    const err: DslError = { line: 1, code: 'wrong-verb', params: { verb: 'call', target: 'B', type: 'broker' } }
    expect(dslErrorText('es', err)).not.toContain('¿')
    expect(dslErrorText('en', err)).not.toContain('?')
    expect(dslErrorText('es', err)).toContain('Broker')
  })

  it('prefixes the line', () => {
    const [err] = compileBehavior('on request:\n  query Pagos\n', []).errors
    expect(dslErrorLine('es', err)).toBe('línea 2: "Pagos" no está conectado')
    expect(dslErrorLine('en', err)).toBe('line 2: "Pagos" is not connected')
  })
})

describe('behaviorSummary', () => {
  it('default, handlers and errors, singular and plural', () => {
    expect(behaviorSummary('es', { kind: 'default' })).toBe('Por defecto')
    expect(behaviorSummary('en', { kind: 'default' })).toBe('Default')
    expect(behaviorSummary('es', { kind: 'active', handlers: 1 })).toBe('1 handler')
    expect(behaviorSummary('es', { kind: 'active', handlers: 2 })).toBe('2 handlers')
    expect(behaviorSummary('en', { kind: 'active', handlers: 3 })).toBe('3 handlers')
    const one = behaviorStatus('on request:\n  query X\n', [])
    const two = behaviorStatus('on request:\n  query X\n  query Y\n', [])
    expect(behaviorSummary('es', one)).toBe('⚠ 1 error')
    expect(behaviorSummary('es', two)).toBe('⚠ 2 errores')
    expect(behaviorSummary('en', one)).toBe('⚠ 1 error')
    expect(behaviorSummary('en', two)).toBe('⚠ 2 errors')
  })
})

describe('examples and reference', () => {
  it('each component type has an example that parses without syntax errors, with the right handler', () => {
    const cases = { service: 'request', worker: 'message', subscriber: 'event' } as const
    for (const lang of ['es', 'en'] as const) {
      for (const [type, on] of Object.entries(cases)) {
        const text = behaviorExample(lang, type)
        const { program, errors } = compileBehavior(text, [{ name: lang === 'es' ? 'Base de datos' : 'Database', type: 'database' }, { name: lang === 'es' ? 'Pagos' : 'Payments', type: 'service' }])
        expect(errors, `${lang}/${type}`).toEqual([])
        expect(program.handlers.map((h) => h.on)).toEqual([on])
      }
    }
    expect(behaviorExample('es', 'service')).toContain('call ')
    expect(behaviorExample('es', 'service')).toContain('query ')
    expect(behaviorExample('es', 'worker')).toContain('fail ')
  })

  it('the reference lists every keyword with English syntax and translated prose', () => {
    const es = referenceRows('es')
    const en = referenceRows('en')
    const all = es.map((r) => r.syntax).join(' ')
    for (const kw of ['on request', 'on event', 'on message', 'call', 'query', 'enqueue', 'publish', 'parallel:', 'wait', 'fail', 'reply', 'session', 'nowait', 'or reply', 'or continue'])
      expect(all).toContain(kw)
    expect(en.length).toBe(es.length)
    es.forEach((r, i) => expect(r.text).not.toBe(en[i].text))
  })
})
