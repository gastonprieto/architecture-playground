import { describe, expect, it } from 'vitest'
import { DB_KIND_DEFAULTS, database } from '../../src/components/database'

describe('database processingTime slider', () => {
  it('steps by 10 so every kind default is reachable', () => {
    const f = database.config.processingTime
    if (f.type !== 'number') throw new Error('expected a number field')
    expect(f.step).toBe(10)
    for (const { processingTime } of Object.values(DB_KIND_DEFAULTS)) {
      expect((processingTime - f.min) % (f.step ?? 1)).toBe(0)
    }
  })
})
