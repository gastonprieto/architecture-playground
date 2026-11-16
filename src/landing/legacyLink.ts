/** Path of the playground, served from play/index.html. */
export const PLAY_PATH = '/play'

/**
 * Shared links used to point at the site root (`/#g=…`). Now the root is the landing page, so a
 * link with a graph hash goes on to the playground with the same hash. Returns the URL to go to,
 * or null when the hash is not a shared graph.
 */
export function playUrlForLegacyHash(hash: string, search = ''): string | null {
  if (!hash.startsWith('#g=') || hash.length <= 3) return null
  return PLAY_PATH + search + hash
}
