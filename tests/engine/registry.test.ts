import { describe, expect, it } from 'vitest'
import { Registry, defaultConfig, defineComponent, processingFields } from '../../src/engine/registry'

const make = (type: string, label = type) =>
  defineComponent({
    type,
    label,
    icon: 'x',
    color: 'ok',
    config: { ...processingFields },
    initialState: () => ({}),
    onMessage() {},
  })

describe('defineComponent', () => {
  it('adds a name field defaulting to the label', () => {
    const def = make('cache', 'Cache')
    expect(def.config.name).toEqual({ type: 'text', label: 'Nombre', default: 'Cache' })
  })
})

describe('defaultConfig', () => {
  it('maps every field to its default', () => {
    expect(defaultConfig(make('w', 'Worker'))).toEqual({
      name: 'Worker',
      up: true,
      processingTime: 400,
      capacity: 2,
      queueMax: 10,
    })
  })
})

describe('Registry', () => {
  it('throws on duplicate type', () => {
    const r = new Registry()
    r.register(make('a'))
    expect(() => r.register(make('a'))).toThrow()
  })
  it('keeps insertion order and gets by type', () => {
    const r = new Registry()
    r.register(make('b'))
    r.register(make('a'))
    expect(r.list().map((d) => d.type)).toEqual(['b', 'a'])
    expect(r.get('a')?.type).toBe('a')
    expect(r.get('zzz')).toBeUndefined()
  })
})
