/** Minimal typed event emitter. Listeners run synchronously in subscription order. */
export class Emitter<E extends object> {
  private listeners = new Map<keyof E, Set<(p: never) => void>>()

  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let set = this.listeners.get(k)
    if (!set) this.listeners.set(k, (set = new Set()))
    set.add(fn as (p: never) => void)
    return () => {
      set.delete(fn as (p: never) => void)
    }
  }

  emit<K extends keyof E>(k: K, p: E[K]): void {
    const set = this.listeners.get(k)
    if (!set) return
    for (const fn of [...set]) (fn as (p: E[K]) => void)(p)
  }
}
