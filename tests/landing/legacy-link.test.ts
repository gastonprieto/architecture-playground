import { describe, expect, it } from 'vitest'
import { encodeHash } from '../../src/persistence/hash'
import { playUrlForLegacyHash } from '../../src/landing/legacyLink'

describe('playUrlForLegacyHash', () => {
  it('sends an old shared link (graph hash at the root) to the playground with the same hash', () => {
    const hash = encodeHash({ nodes: [], edges: [] })
    expect(playUrlForLegacyHash(hash)).toBe(`/play${hash}`)
  })

  it('keeps the query string (?lang=en) so the language survives the redirect', () => {
    expect(playUrlForLegacyHash('#g=abc', '?lang=en')).toBe('/play?lang=en#g=abc')
  })

  it('leaves the landing alone for no hash, an anchor or an empty graph hash', () => {
    expect(playUrlForLegacyHash('')).toBeNull()
    expect(playUrlForLegacyHash('#features')).toBeNull()
    expect(playUrlForLegacyHash('#g=')).toBeNull()
  })
})
