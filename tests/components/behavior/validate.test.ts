import { describe, expect, it } from 'vitest'
import { compileBehavior, parseBehavior, validateBehavior, type DslError } from '../../../src/components/behavior'

const outputs = [
  { name: 'Base de datos', type: 'database' },
  { name: 'Cache', type: 'cache' },
  { name: 'Stock', type: 'service' },
  { name: 'Pagos', type: 'service' },
  { name: 'Mails', type: 'load-balancer' },
  { name: 'Proxy', type: 'reverse-proxy' },
  { name: 'Facturas', type: 'queue' },
  { name: 'Broker', type: 'broker' },
]

const EXAMPLE = `on request /ordenes:
  query Base de datos
  parallel:
    call Stock /reservas
    call Pagos /cobros or reply 402
  call Mails /enviar nowait
  publish OrdenCreada
  enqueue Facturas
  reply 201

on request:
  reply 404

on event PagoRechazado:
  call Stock /liberar or continue

on message:
  fail 10%
  query Base de datos
`

const validate = (text: string, outs = outputs): DslError[] => validateBehavior(parseBehavior(text).program, outs)
const codes = (errors: DslError[]) => errors.map((e) => [e.code, e.line])

describe('validateBehavior', () => {
  it('accepts the spec §2 example with its outputs connected', () => {
    expect(validate(EXAMPLE)).toEqual([])
    expect(compileBehavior(EXAMPLE, outputs).errors).toEqual([])
  })

  it('accepts every valid verb/type pair', () => {
    const text = [
      'on request:',
      '  call Stock /a',
      '  call Mails /a',
      '  call Proxy /a',
      '  query Base de datos',
      '  query Cache',
      '  enqueue Facturas',
      '  publish X',
    ].join('\n')
    expect(validate(text)).toEqual([])
  })

  it('matches names after trimming and through quotes', () => {
    const outs = [{ name: '  Base de datos ', type: 'database' }]
    expect(validate('on request:\n  query "Base de datos"\n  query Base de datos\n', outs)).toEqual([])
  })

  it('not-connected', () => {
    expect(validate('on request:\n  reply 200\n  call Inventario /x\n')).toEqual([
      { line: 3, code: 'not-connected', params: { target: 'Inventario' } },
    ])
  })

  it('ambiguous-target', () => {
    const outs = [...outputs, { name: 'Stock', type: 'service' }]
    expect(validate('on request:\n  call Stock /x\n', outs)).toEqual([
      { line: 2, code: 'ambiguous-target', params: { target: 'Stock' } },
    ])
  })

  it('wrong-verb with a suggestion', () => {
    const errors = validate(
      'on request:\n  call Base de datos /x\n  query Pagos\n  call Facturas /x\n  enqueue Cache\n  query Facturas nowait\n',
    )
    expect(codes(errors)).toEqual([
      ['wrong-verb', 2],
      ['wrong-verb', 3],
      ['wrong-verb', 4],
      ['wrong-verb', 5],
      ['wrong-verb', 6],
    ])
    expect(errors.map((e) => e.params?.suggestion)).toEqual(['query', 'call', 'enqueue', 'query', 'enqueue'])
    expect(errors[0].params).toMatchObject({ verb: 'call', target: 'Base de datos', suggestion: 'query' })
  })

  it('wrong-verb inside parallel', () => {
    expect(codes(validate('on request:\n  parallel:\n    call Cache /x\n'))).toEqual([['wrong-verb', 3]])
  })

  it('no-broker', () => {
    const outs = outputs.filter((o) => o.type !== 'broker')
    expect(validate('on request:\n  reply 200\n  publish OrdenCreada\n', outs)).toEqual([{ line: 3, code: 'no-broker' }])
  })

  it('duplicate-handler', () => {
    const text = [
      'on request /a:',
      '  reply 200',
      'on request /b:',
      '  reply 200',
      'on request /a:',
      '  reply 201',
      'on request:',
      '  reply 404',
      'on request:',
      '  reply 404',
      'on event X:',
      '  reply 200',
      'on event X:',
      '  reply 200',
      'on event:',
      '  reply 200',
      'on message:',
      '  reply 200',
      'on message:',
      '  reply 200',
    ].join('\n')
    expect(codes(validate(text))).toEqual([
      ['duplicate-handler', 5],
      ['duplicate-handler', 9],
      ['duplicate-handler', 13],
      ['duplicate-handler', 19],
    ])
  })
})

describe('compileBehavior', () => {
  it('returns parse and validation errors together, ordered by line', () => {
    const { program, errors } = compileBehavior('on request:\n  call Nadie /x\n  reply 999\n', outputs)
    expect(codes(errors)).toEqual([
      ['not-connected', 2],
      ['code-range', 3],
    ])
    expect(program.handlers).toHaveLength(1)
  })
})

describe('validateBehavior: unicode normalization', () => {
  it('matches a decomposed accent in the DSL against a composed name (NFC on both sides)', () => {
    const composed = 'Depósito'.normalize('NFC')
    const decomposed = 'Depósito'.normalize('NFD')
    expect(composed).not.toBe(decomposed)
    const { errors } = compileBehavior(`on request:\n  query ${decomposed}\n`, [{ name: composed, type: 'database' }])
    expect(errors).toEqual([])
    const reverse = compileBehavior(`on request:\n  query ${composed}\n`, [{ name: decomposed, type: 'database' }])
    expect(reverse.errors).toEqual([])
  })
})
