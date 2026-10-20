import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { defineComponent, processingFields } from '../../src/engine/registry'
import { lookup } from '../../src/i18n'
import { actionLabel, componentLabel, fieldLabel, optionLabel, unknownTypeTitle } from '../../src/i18n/componentText'

const client = defaultRegistry.get('client')!
const queue = defaultRegistry.get('queue')!

/** A third-party component with no translations at all. */
const thirdParty = defineComponent({
  type: 'third-party',
  label: 'Tercero',
  icon: '🧩',
  color: 'ok',
  config: {
    capacity: processingFields.capacity,
    speed: { type: 'number', label: 'Velocidad', default: 1, min: 0, max: 10 },
    flavor: { type: 'select', label: 'Sabor', default: 'a', options: [{ value: 'a', label: 'Ananá' }] },
  },
  initialState: () => ({}),
  onMessage() {},
  actions: { go: { label: 'Ir', run() {} } },
})

describe('componentText', () => {
  it('translates built-in components through components.<type>.*', () => {
    expect(componentLabel('en', 'client', client)).toBe('Client')
    expect(componentLabel('es', 'client', client)).toBe('Cliente')
    expect(fieldLabel('en', client, 'kind')).toBe('Type')
    expect(fieldLabel('en', client, 'burstSize')).toBe('Burst size')
    expect(optionLabel('en', client, 'kind', 'event')).toBe('Event')
    expect(optionLabel('es', client, 'kind', 'event')).toBe('Evento')
    expect(actionLabel('en', client, 'burst')).toBe('Burst')
    expect(fieldLabel('en', queue, 'maxRetries')).toBe('Max retries')
  })

  it('uses the shared fields.<key> for name and processing fields', () => {
    expect(fieldLabel('en', client, 'name')).toBe('Name')
    expect(fieldLabel('en', defaultRegistry.get('service')!, 'processingTime')).toBe('Processing time')
    expect(fieldLabel('en', thirdParty, 'capacity')).toBe('Capacity')
    expect(fieldLabel('es', thirdParty, 'name')).toBe('Nombre')
  })

  it("falls back to the def's own text when there is no key", () => {
    expect(componentLabel('en', 'third-party', thirdParty)).toBe('Tercero')
    expect(fieldLabel('en', thirdParty, 'speed')).toBe('Velocidad')
    expect(optionLabel('en', thirdParty, 'flavor', 'a')).toBe('Ananá')
    expect(actionLabel('en', thirdParty, 'go')).toBe('Ir')
  })

  it('an unregistered type is "Unknown" / "Desconocido"', () => {
    expect(componentLabel('en', 'nope', undefined)).toBe('Unknown')
    expect(componentLabel('es', 'nope', undefined)).toBe('Desconocido')
    expect(unknownTypeTitle('en', 'nope')).toBe('Unknown type: nope')
    expect(unknownTypeTitle('es', 'nope')).toBe('Tipo desconocido: nope')
  })

  it('every built-in label, field, option and action has a key, and es reproduces the def text', () => {
    const has = (key: string) => lookup('es', key) !== undefined
    for (const def of defaultRegistry.list()) {
      const base = `components.${def.type}`
      expect(has(`${base}.label`), `${def.type} label`).toBe(true)
      expect(componentLabel('es', def.type, def)).toBe(def.label)
      for (const [key, field] of Object.entries(def.config)) {
        expect(has(`${base}.fields.${key}`) || has(`fields.${key}`), `${def.type}.${key}`).toBe(true)
        expect(fieldLabel('es', def, key), `${def.type}.${key}`).toBe(field.label)
        if (field.type !== 'select') continue
        for (const o of field.options) {
          expect(has(`${base}.options.${key}.${o.value}`), `${def.type}.${key}=${o.value}`).toBe(true)
          expect(optionLabel('es', def, key, o.value)).toBe(o.label)
        }
      }
      for (const [name, a] of Object.entries(def.actions ?? {})) {
        expect(has(`${base}.actions.${name}`), `${def.type} action ${name}`).toBe(true)
        expect(actionLabel('es', def, name)).toBe(a.label)
      }
    }
  })
})
