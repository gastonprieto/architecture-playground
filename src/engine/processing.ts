import type { Message, NodeStats } from './types'

/** What a Processor needs from the engine, bound to one node. */
export interface ProcessingHost {
  /** The node's current (live) config. */
  config(): Record<string, unknown>
  /** The node's stats object; the processor mutates inFlight/queued in place. */
  stats: NodeStats
  /** Emit node:stats after a stats change. */
  statsChanged(): void
  /** Node-owned timer (skipped if the node is removed meanwhile). */
  schedule(ms: number, fn: () => void): void
  drop(msg: Message, reason: string, code: number): void
}

/** Processing settings read from config; missing fields mean "not a processing component". */
export interface ProcessingSettings {
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
}

export function readProcessing(config: Record<string, unknown>): ProcessingSettings {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback)
  return {
    up: config.up !== false,
    processingTime: num(config.processingTime, 0),
    capacity: num(config.capacity, Infinity),
    queueMax: num(config.queueMax, Infinity),
  }
}

interface Job {
  msg: Message
  /** Called after processingTime with the slot held; the slot frees on `release()`. */
  run: (release: () => void) => void
}

/**
 * Per-node processing: `capacity` concurrent slots, a FIFO queue bounded by `queueMax`, and up/down.
 * A down node rejects arrivals with 503 'down'; work already in flight still finishes.
 */
export class Processor {
  private queue: Job[] = []
  private host: ProcessingHost

  constructor(host: ProcessingHost) {
    this.host = host
  }

  /** Holds a slot for `processingTime`, then calls `done` and frees the slot. */
  process(msg: Message, done: () => void): void {
    this.occupy(msg, (release) => {
      done()
      release()
    })
  }

  /**
   * Same admission as `process`, but after `processingTime` it calls `run(release)` and keeps the slot
   * until `release()` is called. `release` is idempotent.
   */
  occupy(msg: Message, run: (release: () => void) => void): void {
    const s = readProcessing(this.host.config())
    const stats = this.host.stats
    if (!s.up) {
      this.host.drop(msg, 'down', 503)
    } else if (stats.inFlight < s.capacity) {
      this.start({ msg, run })
    } else if (this.queue.length < s.queueMax) {
      this.queue.push({ msg, run })
      this.syncQueued()
    } else {
      this.host.drop(msg, 'queue-full', 503)
    }
  }

  /** Re-evaluate after a config change: a down node rejects its queue; freed capacity starts queued work. */
  reconfigure(): void {
    const s = readProcessing(this.host.config())
    if (!s.up) {
      const rejected = this.queue
      this.queue = []
      if (rejected.length > 0) this.syncQueued()
      for (const job of rejected) this.host.drop(job.msg, 'down', 503)
      return
    }
    this.pump()
  }

  private start(job: Job): void {
    this.host.stats.inFlight++
    this.host.statsChanged()
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.host.stats.inFlight--
      this.host.statsChanged()
      this.pump()
    }
    this.host.schedule(readProcessing(this.host.config()).processingTime, () => job.run(release))
  }

  /** Start queued jobs while there are free slots and the node is up. */
  private pump(): void {
    while (this.queue.length > 0) {
      const s = readProcessing(this.host.config())
      if (!s.up || this.host.stats.inFlight >= s.capacity) return
      const job = this.queue.shift()!
      this.syncQueued()
      this.start(job)
    }
  }

  private syncQueued(): void {
    this.host.stats.queued = this.queue.length
    this.host.statsChanged()
  }
}
