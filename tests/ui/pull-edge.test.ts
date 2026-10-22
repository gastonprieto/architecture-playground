import { describe, expect, it } from 'vitest'
import { isPullEdge } from '../../src/ui/canvas/Canvas'

describe('isPullEdge', () => {
  it('a queue or broker feeding a consumer is a pull edge (arrow points back at the source)', () => {
    expect(isPullEdge('queue', 'worker')).toBe(true)
    expect(isPullEdge('queue', 'service')).toBe(true)
    expect(isPullEdge('broker', 'subscriber')).toBe(true)
    expect(isPullEdge('broker', 'service')).toBe(true)
  })

  it('dead-letter and fire-and-forget hops stay push (arrow points at the target)', () => {
    // Queue → DLQ is a dead-letter push.
    expect(isPullEdge('queue', 'dlq')).toBe(false)
    // Broker → queue is fire-and-forget.
    expect(isPullEdge('broker', 'queue')).toBe(false)
  })

  it('edges that do not leave a queue/broker are never pull', () => {
    expect(isPullEdge('client', 'queue')).toBe(false)
    expect(isPullEdge('load-balancer', 'service')).toBe(false)
    expect(isPullEdge('service', 'database')).toBe(false)
    expect(isPullEdge(undefined, 'worker')).toBe(false)
  })
})
