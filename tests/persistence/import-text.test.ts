import { describe, expect, it } from 'vitest'
import { parseAnyGraph } from '../../src/persistence/importText'
import { serializeGraph } from '../../src/persistence/serialize'
import { getPresets } from '../../src/presets'

describe('parseAnyGraph', () => {
  const graph = getPresets('es')[0].graph

  it('reads JSON', () => {
    const r = parseAnyGraph(serializeGraph(graph))
    expect(r.ok).toBe(true)
  })

  it('reports JSON errors as json', () => {
    expect(parseAnyGraph('{nope')).toEqual({ ok: false, format: 'json', error: { error: 'invalid-json' } })
  })

  it('detects JSON after a BOM and whitespace', () => {
    expect(parseAnyGraph('﻿  ' + serializeGraph(graph)).ok).toBe(true)
  })

  it('reads the DSL', () => {
    expect(parseAnyGraph('client W').ok).toBe(true)
  })

  it('reports DSL errors as dsl', () => {
    const r = parseAnyGraph('servise W')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.format).toBe('dsl')
      if (r.format === 'dsl') expect(r.errors[0].code).toBe('unknown-type')
    }
  })
})
