import { describe, expect, it } from 'vitest'
import type { Message, MessageKind } from '../../src/engine/types'
import { CLIENT_COLORS, C } from '../../src/ui/colors'
import {
  MAX_PACKETS,
  colorFor,
  packetStyle,
  easeInOut,
  packetsReducer,
  shapeFor,
  type Packet,
} from '../../src/ui/canvas/PacketLayer'

const msg = (id: string, kind: MessageKind = 'request', extra: Partial<Message> = {}): Message => ({
  id,
  kind,
  meta: {},
  trail: [],
  createdAt: 0,
  ...extra,
})

const packet = (i: number, start = i, duration = 600): Packet => ({
  key: i,
  msg: msg(`m${i}`),
  from: 'A',
  to: 'B',
  start,
  duration,
})

describe('packetsReducer', () => {
  it('keeps exactly MAX_PACKETS, newest first, evicting the oldest', () => {
    expect(MAX_PACKETS).toBe(300)
    let state: Packet[] = []
    for (let i = 0; i < 350; i++) state = packetsReducer(state, { type: 'sent', packet: packet(i) })
    expect(state).toHaveLength(300)
    expect(state[0].key).toBe(349)
    expect(state[299].key).toBe(50)
  })

  it('removes packets past start + duration on prune', () => {
    let state: Packet[] = []
    state = packetsReducer(state, { type: 'sent', packet: packet(1, 0, 600) })
    state = packetsReducer(state, { type: 'sent', packet: packet(2, 500, 600) })
    state = packetsReducer(state, { type: 'prune', now: 700 })
    expect(state.map((p) => p.key)).toEqual([2])
    state = packetsReducer(state, { type: 'prune', now: 1101 })
    expect(state).toEqual([])
  })

  it('prune returns the same array when nothing expired', () => {
    const state = packetsReducer([], { type: 'sent', packet: packet(1, 0, 600) })
    expect(packetsReducer(state, { type: 'prune', now: 300 })).toBe(state)
  })

  it('clear empties the list', () => {
    const state = packetsReducer([], { type: 'sent', packet: packet(1) })
    expect(packetsReducer(state, { type: 'clear' })).toEqual([])
  })
})

describe('shapeFor / colorFor', () => {
  it('maps kinds to shapes', () => {
    expect(shapeFor('request')).toBe('circle')
    expect(shapeFor('message')).toBe('square')
    expect(shapeFor('event')).toBe('diamond')
    expect(shapeFor('response')).toBe('circle')
  })

  it('colors requests, messages and responses by status', () => {
    expect(colorFor(msg('a', 'request'))).toBe(C.req)
    expect(colorFor(msg('a', 'message'))).toBe(CLIENT_COLORS[0])
    expect(colorFor(msg('a', 'response', { status: 'ok', code: 200 }))).toBe(C.ok)
    expect(colorFor(msg('a', 'response', { status: 'error', code: 503 }))).toBe(C.err)
  })

  it('colors events by a stable hash of eventType', () => {
    const a = colorFor(msg('a', 'event', { meta: { eventType: 'order.created' } }))
    expect(CLIENT_COLORS).toContain(a)
    expect(colorFor(msg('b', 'event', { meta: { eventType: 'order.created' } }))).toBe(a)
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => colorFor(msg('x', 'event', { meta: { eventType: t } }))))
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('easeInOut', () => {
  it('is 0 at 0, 1 at 1, 0.5 at 0.5 and clamps', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
    expect(easeInOut(-1)).toBe(0)
    expect(easeInOut(2)).toBe(1)
  })
})

describe('packetStyle', () => {
  const pink = '#f472b6'
  it('fills every kind with the client color when the message carries one', () => {
    for (const kind of ['request', 'message', 'event'] as const)
      expect(packetStyle(msg('a', kind, { meta: { clientColor: pink, eventType: 'x' } }))).toEqual({ fill: pink })
  })

  it('responses keep the client fill with an ok/error stroke', () => {
    expect(packetStyle(msg('a', 'response', { status: 'ok', code: 200, meta: { clientColor: pink } }))).toEqual({ fill: pink, stroke: C.ok })
    expect(packetStyle(msg('a', 'response', { status: 'error', code: 503, meta: { clientColor: pink } }))).toEqual({ fill: pink, stroke: C.err })
  })

  it('without a client color everything is as before', () => {
    for (const m of [
      msg('a', 'request'),
      msg('a', 'message'),
      msg('a', 'event', { meta: { eventType: 'order.created' } }),
      msg('a', 'response', { status: 'ok', code: 200 }),
      msg('a', 'response', { status: 'error', code: 503, meta: { clientColor: '' } }),
    ])
      expect(packetStyle(m)).toEqual({ fill: colorFor(m) })
  })
})
