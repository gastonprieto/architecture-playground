import type { Graph } from '../engine/types'
import type { Lang } from '../i18n'
import { getPresets } from '../presets'
import { decodeHash } from './hash'
import { loadLocal } from './storage'

const currentHash = (): string => {
  try {
    return globalThis.location?.hash ?? ''
  } catch {
    return ''
  }
}

/** Preset shown on a first visit (no shared link, nothing saved). */
export const DEFAULT_PRESET = 'load-balancer'

/**
 * Startup graph: URL hash, then localStorage, then the default preset in `lang`. `onHashLoaded`
 * runs when the graph came from the hash (the app clears it so a reload does not bring the link back);
 * `onPresetLoaded` when it is the default preset.
 */
export function initialGraph(
  lang: Lang,
  hash: string = currentHash(),
  onHashLoaded?: () => void,
  onPresetLoaded?: (id: string) => void,
): Graph {
  const fromHash = decodeHash(hash)
  if (fromHash) {
    onHashLoaded?.()
    return fromHash
  }
  const local = loadLocal()
  if (local) return local
  onPresetLoaded?.(DEFAULT_PRESET)
  return getPresets(lang).find((p) => p.id === DEFAULT_PRESET)!.graph
}

/** Drops the hash from the address bar without adding a history entry. */
export function clearLocationHash(): void {
  try {
    globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search)
  } catch {
    // No history API (non-browser environment): nothing to clear.
  }
}
