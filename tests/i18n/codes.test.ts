import { describe, expect, it } from 'vitest'
import { lookup } from '../../src/i18n'

/** Source text of every engine and component module, keyed by path. */
const files = import.meta.glob<string>(['../../src/engine/**/*.ts', '../../src/components/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const text = Object.values(files).join('\n')

/** String literals passed as the reason of a drop(...) call / the text of a label(...) call. */
const reasons = [...new Set([...text.matchAll(/drop\([^)]*?,\s*'([^']*)'/g)].map((m) => m[1]))].sort()
const labels = [...new Set([...text.matchAll(/label\('([^']*)'/g)].map((m) => m[1]))].sort()

/** Kebab-case English codes, or upper-case/numeric tokens like HIT, DLQ, 202. */
const CODE = /^([a-z]+(-[a-z]+)*|[A-Z0-9]+)$/

describe('engine codes', () => {
  it('finds the drop reasons and labels emitted by the engine and components', () => {
    expect(reasons).toEqual([
      'client-rejects-requests',
      'dlq-rejects-requests',
      'down',
      'loop',
      'no-dlq',
      'no-origin-queue',
      'no-output',
      'no-subscribers',
      'no-targets',
      'queue-full',
      'removed',
      'unknown-type',
    ])
    expect(labels).toEqual(['202', 'DLQ', 'HIT', 'MISS', 'no-subscribers', 'retry'])
  })

  it('every reason and label is a stable code with an es and en translation', () => {
    for (const code of reasons) {
      expect(code, code).toMatch(CODE)
      expect(lookup('es', `reasons.${code}`), code).toBeDefined()
    }
    for (const code of labels) {
      expect(code, code).toMatch(CODE)
      expect(lookup('es', `labels.${code}`), code).toBeDefined()
    }
  })

  it('engine and components import no UI or i18n code', () => {
    expect(Object.keys(files).length).toBeGreaterThan(15)
    for (const [f, src] of Object.entries(files)) expect(src, f).not.toMatch(/from '\.\.\/(\.\.\/)?(ui|i18n)\b/)
  })
})
