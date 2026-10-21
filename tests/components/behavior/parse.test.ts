import { describe, expect, it } from 'vitest'
import { parseBehavior, type DslError } from '../../../src/components/behavior'

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

const codes = (errors: DslError[]) => errors.map((e) => [e.code, e.line])

describe('parseBehavior', () => {
  it('parses the spec §2 example', () => {
    const { program, errors } = parseBehavior(EXAMPLE)
    expect(errors).toEqual([])
    expect(program).toEqual({
      handlers: [
        {
          on: 'request',
          line: 1,
          prefix: '/ordenes',
          steps: [
            { kind: 'query', line: 2, target: 'Base de datos' },
            {
              kind: 'parallel',
              line: 3,
              steps: [
                { kind: 'call', line: 4, target: 'Stock', path: '/reservas' },
                { kind: 'call', line: 5, target: 'Pagos', path: '/cobros', mod: { kind: 'orReply', code: 402 } },
              ],
            },
            { kind: 'call', line: 6, target: 'Mails', path: '/enviar', mod: { kind: 'nowait' } },
            { kind: 'publish', line: 7, eventType: 'OrdenCreada' },
            { kind: 'enqueue', line: 8, target: 'Facturas' },
            { kind: 'reply', line: 9, code: 201 },
          ],
        },
        { on: 'request', line: 11, steps: [{ kind: 'reply', line: 12, code: 404 }] },
        {
          on: 'event',
          line: 14,
          eventType: 'PagoRechazado',
          steps: [{ kind: 'call', line: 15, target: 'Stock', path: '/liberar', mod: { kind: 'orContinue' } }],
        },
        {
          on: 'message',
          line: 17,
          steps: [
            { kind: 'fail', line: 18, percent: 10, code: 500 },
            { kind: 'query', line: 19, target: 'Base de datos' },
          ],
        },
      ],
    })
  })

  it('parses an empty text to an empty program', () => {
    expect(parseBehavior('')).toEqual({ program: { handlers: [] }, errors: [] })
    expect(parseBehavior('\n  \n# just a comment\n')).toEqual({ program: { handlers: [] }, errors: [] })
  })

  it('normalizes CRLF line endings', () => {
    const { program, errors } = parseBehavior(EXAMPLE.replace(/\n/g, '\r\n'))
    expect(errors).toEqual([])
    expect(program).toEqual(parseBehavior(EXAMPLE).program)
  })

  it('ignores comments and trailing spaces', () => {
    const text = '# header comment\non message:   # trailing comment\n  # indented comment\n  wait 200   \n\n  reply 202 # done\n'
    const { program, errors } = parseBehavior(text)
    expect(errors).toEqual([])
    expect(program.handlers).toEqual([
      {
        on: 'message',
        line: 2,
        steps: [
          { kind: 'wait', line: 4, ms: 200 },
          { kind: 'reply', line: 6, code: 202 },
        ],
      },
    ])
  })

  it('reads quoted names with spaces and accents', () => {
    const text = 'on request:\n  query "Base de datos"\n  call "Órdenes nowait" /crear or reply 503\n  enqueue Facturación pendiente nowait\n'
    const { program, errors } = parseBehavior(text)
    expect(errors).toEqual([])
    expect(program.handlers[0].steps).toEqual([
      { kind: 'query', line: 2, target: 'Base de datos' },
      { kind: 'call', line: 3, target: 'Órdenes nowait', path: '/crear', mod: { kind: 'orReply', code: 503 } },
      { kind: 'enqueue', line: 4, target: 'Facturación pendiente', mod: { kind: 'nowait' } },
    ])
  })

  it('nests parallel blocks', () => {
    const text = [
      'on request:',
      '  parallel:',
      '    call A /a',
      '    parallel:',
      '      query DB',
      '      wait 50',
      '  reply 200',
    ].join('\n')
    const { program, errors } = parseBehavior(text)
    expect(errors).toEqual([])
    expect(program.handlers[0].steps).toEqual([
      {
        kind: 'parallel',
        line: 2,
        steps: [
          { kind: 'call', line: 3, target: 'A', path: '/a' },
          {
            kind: 'parallel',
            line: 4,
            steps: [
              { kind: 'query', line: 5, target: 'DB' },
              { kind: 'wait', line: 6, ms: 50 },
            ],
          },
        ],
      },
      { kind: 'reply', line: 7, code: 200 },
    ])
  })

  it('reads fail with a percent and an optional code', () => {
    const { program, errors } = parseBehavior('on message:\n  fail 10% 503\n  fail 0%\n  fail 100% 429\n')
    expect(errors).toEqual([])
    expect(program.handlers[0].steps).toEqual([
      { kind: 'fail', line: 2, percent: 10, code: 503 },
      { kind: 'fail', line: 3, percent: 0, code: 500 },
      { kind: 'fail', line: 4, percent: 100, code: 429 },
    ])
  })

  it('reads publish and query modifiers', () => {
    const { program, errors } = parseBehavior('on request:\n  publish X or continue\n  query Cache or reply 504\n')
    expect(errors).toEqual([])
    expect(program.handlers[0].steps).toEqual([
      { kind: 'publish', line: 2, eventType: 'X', mod: { kind: 'orContinue' } },
      { kind: 'query', line: 3, target: 'Cache', mod: { kind: 'orReply', code: 504 } },
    ])
  })

  describe('errors', () => {
    it('tab', () => {
      const { program, errors } = parseBehavior('on request:\n\treply 200\n')
      expect(codes(errors)).toEqual([['tab', 2]])
      expect(program.handlers[0].steps).toEqual([{ kind: 'reply', line: 2, code: 200 }])
    })

    it('indent: odd indentation', () => {
      expect(codes(parseBehavior('on request:\n   reply 200\n  reply 201\n').errors)).toEqual([['indent', 2]])
    })

    it('indent: deeper than the block', () => {
      expect(codes(parseBehavior('on request:\n  reply 200\n    reply 201\n').errors)).toEqual([['indent', 3]])
    })

    it('indent: an indented handler header', () => {
      expect(codes(parseBehavior('on request:\n  reply 200\n  on message:\n    reply 200\n').errors)).toEqual([['indent', 3]])
    })

    it('unknown-keyword: unknown step', () => {
      const { errors } = parseBehavior('on request:\n  reply 200\n  llamar Stock /x\n')
      expect(errors).toEqual([{ line: 3, code: 'unknown-keyword', params: { word: 'llamar' } }])
    })

    it('unknown-keyword: uppercase keyword', () => {
      expect(codes(parseBehavior('on request:\n  Reply 200\n').errors)).toEqual([['unknown-keyword', 2]])
    })

    it('unknown-keyword: unknown handler kind', () => {
      const { errors } = parseBehavior('on click:\n  reply 200\n')
      expect(errors).toEqual([{ line: 1, code: 'unknown-keyword', params: { word: 'click' } }])
    })

    it('unknown-keyword: unknown modifier', () => {
      expect(codes(parseBehavior('on request:\n  call A /a or retry\n').errors)).toEqual([['unknown-keyword', 2]])
    })

    it('missing-colon: handler', () => {
      expect(codes(parseBehavior('on request /a\n  reply 200\n').errors)).toEqual([['missing-colon', 1]])
    })

    it('missing-colon: parallel', () => {
      expect(codes(parseBehavior('on request:\n  parallel\n    reply 200\n').errors)).toEqual([['missing-colon', 2]])
    })

    it('bad-number', () => {
      const { errors } = parseBehavior('on request:\n  wait mucho\n  reply ok\n  fail 10\n  call A /a or reply\n')
      expect(codes(errors)).toEqual([
        ['bad-number', 2],
        ['bad-number', 3],
        ['bad-number', 4],
        ['bad-number', 5],
      ])
      expect(errors[0].params).toEqual({ value: 'mucho' })
    })

    it('fail-range', () => {
      const { errors } = parseBehavior('on message:\n  fail 150%\n')
      expect(errors).toEqual([{ line: 2, code: 'fail-range', params: { value: 150 } }])
    })

    it('code-range', () => {
      const { errors } = parseBehavior('on request:\n  reply 700\n  fail 5% 99\n  call A /a or reply 600\n')
      expect(codes(errors)).toEqual([
        ['code-range', 2],
        ['code-range', 3],
        ['code-range', 4],
      ])
      expect(errors[0].params).toEqual({ value: 700 })
    })

    it('call-missing-path', () => {
      const { errors } = parseBehavior('on request:\n  call Stock\n  call Pagos nowait\n')
      expect(errors).toEqual([
        { line: 2, code: 'call-missing-path', params: { target: 'Stock' } },
        { line: 3, code: 'call-missing-path', params: { target: 'Pagos' } },
      ])
    })

    it('missing-target', () => {
      const { errors } = parseBehavior('on request:\n  call /x\n  query\n  enqueue nowait\n  publish\n')
      expect(codes(errors)).toEqual([
        ['missing-target', 2],
        ['missing-target', 3],
        ['missing-target', 4],
        ['missing-target', 5],
      ])
    })

    it('step-outside-handler', () => {
      expect(codes(parseBehavior('reply 200\non request:\n  reply 200\n').errors)).toEqual([['step-outside-handler', 1]])
    })

    it('empty-block: handler', () => {
      expect(codes(parseBehavior('on request:\non message:\n  reply 200\n').errors)).toEqual([['empty-block', 1]])
    })

    it('empty-block: parallel', () => {
      expect(codes(parseBehavior('on request:\n  parallel:\n  reply 200\n').errors)).toEqual([['empty-block', 2]])
    })

    it('nowait-with-or', () => {
      const { errors } = parseBehavior('on request:\n  call A /a nowait or continue\n  query DB or reply 503 nowait\n')
      expect(codes(errors)).toEqual([
        ['nowait-with-or', 2],
        ['nowait-with-or', 3],
      ])
    })

    it('reports errors with line numbers after CRLF normalization', () => {
      expect(codes(parseBehavior('on request:\r\n  reply 200\r\n  reply 999\r\n').errors)).toEqual([['code-range', 3]])
    })
  })
})

describe('parseBehavior: quoted event types in handlers', () => {
  it('accepts a quoted event type with spaces, like publish does', () => {
    const { program, errors } = parseBehavior('on event "Order Created":\n  reply 200\n')
    expect(errors).toEqual([])
    expect(program.handlers[0]).toMatchObject({ on: 'event', eventType: 'Order Created' })
  })

  it('still reports extra words after an unquoted event type', () => {
    expect(codes(parseBehavior('on event Order Created:\n  reply 200\n').errors)).toEqual([['unknown-keyword', 1]])
  })
})
