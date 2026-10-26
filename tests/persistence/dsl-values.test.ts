import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components'
import type { Field } from '../../src/engine/registry'
import { suggest } from '../../src/persistence/dsl/errors'
import { formatFieldValue, parseFieldValue, quoteIfNeeded, unquote } from '../../src/persistence/dsl/values'

const field = (type: string, key: string): Field => defaultRegistry.get(type)!.config[key]

const processingTime = field('service', 'processingTime')
const capacity = field('service', 'capacity')
const rate = field('client', 'rate')
const mix = field('client', 'mix')
const algorithm = field('load-balancer', 'algorithm')
const text: Field = { type: 'text', label: 't', default: '' }
const color: Field = { type: 'color', label: 'c', default: '#d97706', options: ['#d97706'] }
const list: Field = { type: 'list', label: 'l', default: [] }
const bool: Field = { type: 'boolean', label: 'b', default: false }

describe('parseFieldValue', () => {
  it('parses numbers with and without their unit', () => {
    expect(parseFieldValue(processingTime, '400')).toEqual({ ok: true, value: 400 })
    expect(parseFieldValue(processingTime, '400ms')).toEqual({ ok: true, value: 400 })
    expect(parseFieldValue(rate, '5 req/s')).toEqual({ ok: true, value: 5 })
    expect(parseFieldValue(processingTime, 'abc')).toMatchObject({ ok: false, code: 'bad-value' })
  })

  it('reports numbers outside the field range', () => {
    expect(parseFieldValue(capacity, '0')).toEqual({ ok: false, code: 'out-of-range', params: { min: 1, max: 50 } })
  })

  it('parses booleans', () => {
    expect(parseFieldValue(bool, 'true')).toEqual({ ok: true, value: true })
    expect(parseFieldValue(bool, 'on')).toEqual({ ok: true, value: true })
    expect(parseFieldValue(bool, 'false')).toEqual({ ok: true, value: false })
    expect(parseFieldValue(bool, 'off')).toEqual({ ok: true, value: false })
    expect(parseFieldValue(bool, 'yes')).toMatchObject({ ok: false, code: 'bad-value' })
  })

  it('parses selects against their options', () => {
    expect(parseFieldValue(algorithm, 'weighted')).toEqual({ ok: true, value: 'weighted' })
    const options = (algorithm as Extract<Field, { type: 'select' }>).options.map((o) => o.value).join(', ')
    expect(parseFieldValue(algorithm, 'fastest')).toEqual({ ok: false, code: 'bad-value', params: { options } })
  })

  it('parses text, honoring quotes', () => {
    expect(parseFieldValue(text, 'PagoAprobado')).toEqual({ ok: true, value: 'PagoAprobado' })
    expect(parseFieldValue(text, '"A # B"')).toEqual({ ok: true, value: 'A # B' })
  })

  it('parses colors', () => {
    expect(parseFieldValue(color, '#d97706')).toEqual({ ok: true, value: '#d97706' })
    expect(parseFieldValue(color, 'red')).toMatchObject({ ok: false, code: 'bad-value' })
  })

  it('parses lists', () => {
    expect(parseFieldValue(list, '/static, /img')).toEqual({ ok: true, value: ['/static', '/img'] })
    expect(parseFieldValue(list, '')).toEqual({ ok: true, value: [] })
  })

  it('parses mixes with optional weights', () => {
    expect(parseFieldValue(mix, '/ordenes x3, /productos')).toEqual({
      ok: true,
      value: [{ value: '/ordenes', weight: 3 }, { value: '/productos', weight: 1 }],
    })
    expect(parseFieldValue(mix, '"Orden Creada" x2')).toEqual({ ok: true, value: [{ value: 'Orden Creada', weight: 2 }] })
    expect(parseFieldValue(mix, '/a x-1')).toMatchObject({ ok: false, code: 'bad-value' })
    expect(parseFieldValue(mix, '/a x0')).toEqual({ ok: true, value: [{ value: '/a', weight: 0 }] })
  })

  it('leaves behavior fields to the block parser', () => {
    expect(parseFieldValue(field('service', 'behavior'), 'x')).toMatchObject({ ok: false, code: 'bad-value' })
  })
})

describe('formatFieldValue', () => {
  it('prints the compact form', () => {
    expect(formatFieldValue(mix, [{ value: '/a', weight: 1 }, { value: 'Orden Creada', weight: 2 }])).toBe('/a, "Orden Creada" x2')
    expect(formatFieldValue(list, ['/static', '/img'])).toBe('/static, /img')
    expect(formatFieldValue(bool, true)).toBe('true')
    expect(formatFieldValue(bool, false)).toBe('false')
    expect(formatFieldValue(processingTime, 400)).toBe('400')
    expect(formatFieldValue(text, 'A # B')).toBe('"A # B"')
    expect(formatFieldValue(text, 'PagoAprobado')).toBe('PagoAprobado')
  })

  it('quotes values the graph parser would read as a comment', () => {
    expect(formatFieldValue(text, '#')).toBe('"#"')
    expect(formatFieldValue(text, '# foo')).toBe('"# foo"')
    expect(formatFieldValue(text, '#foo')).toBe('#foo')
    expect(formatFieldValue(list, ['/a', '#'])).toBe('/a, "#"')
    expect(formatFieldValue(mix, [{ value: '#', weight: 2 }])).toBe('"#" x2')
  })

  it('round-trips through parseFieldValue', () => {
    const cases: [Field, unknown][] = [
      [processingTime, 400],
      [rate, 5],
      [bool, true],
      [bool, false],
      [algorithm, 'weighted'],
      [text, 'PagoAprobado'],
      [text, 'A # B'],
      [text, ' padded '],
      [text, '"quoted'],
      [color, '#d97706'],
      [list, ['/static', '/img']],
      [list, []],
      [list, ['a, b', 'c']],
      [mix, [{ value: '/ordenes', weight: 3 }, { value: '/productos', weight: 1 }]],
      [mix, [{ value: 'Orden Creada', weight: 2 }]],
      [mix, [{ value: '/a', weight: 0 }]],
      [mix, [{ value: 'a x3', weight: 1 }]],
      [mix, [{ value: 'a x3', weight: 2 }]],
    ]
    for (const [f, v] of cases) {
      expect(parseFieldValue(f, formatFieldValue(f, v))).toEqual({ ok: true, value: v })
    }
  })
})

describe('quoting', () => {
  it('escapes quotes and backslashes', () => {
    expect(quoteIfNeeded('a"b\\c', /"/)).toBe('"a\\"b\\\\c"')
    expect(unquote('"a\\"b\\\\c"')).toBe('a"b\\c')
    expect(unquote('plain')).toBe('plain')
  })
})

describe('suggest', () => {
  it('finds a close candidate', () => {
    expect(suggest('capacty', ['capacity', 'queueMax'])).toBe('capacity')
    expect(suggest('zzz', ['capacity'])).toBeUndefined()
  })
})
