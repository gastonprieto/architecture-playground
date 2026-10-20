/** The same text on the same node starts at most one label per this many real ms; repeats bump "×N". */
export const REPEAT_MS = 450

export type LabelAdd =
  | { type: 'new'; key: number; slot: number }
  | { type: 'bump'; key: number; count: number }

interface Live {
  id: string
  nodeId: string
  slot: number
  count: number
}

/**
 * Bookkeeping for floating labels: throttles repeats of a node+text into a counter on the visible
 * label, and gives each concurrent label on a node its own stacking slot (lowest free first).
 */
export class LabelBook {
  private seq = 0
  private live = new Map<number, Live>()
  /** node|text → the label currently collecting its repeats and when it was shown. */
  private recent = new Map<string, { key: number; at: number }>()

  add(nodeId: string, text: string, now: number): LabelAdd {
    const id = `${nodeId}|${text}`
    const last = this.recent.get(id)
    const lastLive = last && this.live.get(last.key)
    if (last && lastLive && now - last.at < REPEAT_MS) {
      lastLive.count++
      return { type: 'bump', key: last.key, count: lastLive.count }
    }
    const used = new Set<number>()
    for (const l of this.live.values()) if (l.nodeId === nodeId) used.add(l.slot)
    let slot = 0
    while (used.has(slot)) slot++
    const key = ++this.seq
    this.live.set(key, { id, nodeId, slot, count: 1 })
    this.recent.set(id, { key, at: now })
    return { type: 'new', key, slot }
  }

  remove(key: number): void {
    const l = this.live.get(key)
    if (!l) return
    this.live.delete(key)
    if (this.recent.get(l.id)?.key === key) this.recent.delete(l.id)
  }

  clear(): void {
    this.live.clear()
    this.recent.clear()
  }
}
