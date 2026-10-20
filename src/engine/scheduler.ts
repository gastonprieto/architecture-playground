interface Entry {
  time: number
  seq: number
  id: number
  fn: () => void
}

const before = (a: Entry, b: Entry) =>
  a.time < b.time || (a.time === b.time && a.seq < b.seq)

/** Simulated-time scheduler: a binary min-heap keyed by (time, seq). */
export class Scheduler {
  now = 0
  private heap: Entry[] = []
  private cancelled = new Set<number>()
  private nextId = 1

  at(time: number, fn: () => void): number {
    const id = this.nextId++
    this.push({ time, seq: id, id, fn })
    return id
  }

  after(ms: number, fn: () => void): number {
    return this.at(this.now + ms, fn)
  }

  cancel(id: number): void {
    this.cancelled.add(id)
  }

  advance(ms: number): void {
    const target = this.now + ms
    while (this.heap.length > 0 && this.heap[0].time <= target) {
      const entry = this.pop()
      if (this.cancelled.delete(entry.id)) continue
      this.now = Math.max(this.now, entry.time)
      entry.fn()
    }
    this.now = target
  }

  clear(): void {
    this.heap = []
    this.cancelled.clear()
  }

  private push(entry: Entry): void {
    const h = this.heap
    h.push(entry)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!before(h[i], h[p])) break
      ;[h[i], h[p]] = [h[p], h[i]]
      i = p
    }
  }

  private pop(): Entry {
    const h = this.heap
    const top = h[0]
    const last = h.pop()!
    if (h.length > 0) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < h.length && before(h[l], h[m])) m = l
        if (r < h.length && before(h[r], h[m])) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m], h[i]]
        i = m
      }
    }
    return top
  }
}
