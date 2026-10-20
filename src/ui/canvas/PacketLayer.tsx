import { ViewportPortal, useStoreApi } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import type { Message, MessageKind, NodeId } from '../../engine/types'
import { C, CLIENT_COLORS } from '../colors'
import { boxOf, portPoints, wirePoint } from '../geometry'
import { useSim } from '../runtime/useSimulation'
import { useEditor } from '../store/editor'

/** At most this many packets are drawn; the oldest are evicted first. */
export const MAX_PACKETS = 300

export interface Packet {
  /** Unique per hop (a message id repeats along its path). */
  key: number
  msg: Message
  from: NodeId
  to: NodeId
  /** True when the hop travels against its edge (a response going back), so it rides the wire backwards. */
  reverse?: boolean
  /** Sim time the hop started. */
  start: number
  duration: number
}

export type PacketAction =
  | { type: 'sent'; packet: Packet }
  | { type: 'prune'; now: number }
  | { type: 'clear' }

/** Packet bookkeeping, newest first. Pure: returns the same array when nothing changes. */
export function packetsReducer(state: Packet[], action: PacketAction): Packet[] {
  switch (action.type) {
    case 'sent': {
      const next = [action.packet, ...state]
      if (next.length > MAX_PACKETS) next.length = MAX_PACKETS
      return next
    }
    case 'prune': {
      const next = state.filter((p) => action.now < p.start + p.duration)
      return next.length === state.length ? state : next
    }
    case 'clear':
      return state.length === 0 ? state : []
  }
}

export type PacketShape = 'circle' | 'square' | 'diamond'

export function shapeFor(kind: MessageKind): PacketShape {
  switch (kind) {
    case 'message':
      return 'square'
    case 'event':
      return 'diamond'
    default:
      return 'circle'
  }
}

/** Small stable string hash (djb2). */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function colorFor(msg: Pick<Message, 'kind' | 'status' | 'meta'>): string {
  switch (msg.kind) {
    case 'request':
      return C.req
    case 'message':
      return CLIENT_COLORS[0]
    case 'event':
      return CLIENT_COLORS[hash(msg.meta.eventType ?? '') % CLIENT_COLORS.length]
    case 'response':
      return msg.status === 'ok' ? C.ok : C.err
  }
}

export interface PacketStyle {
  fill: string
  /** Outline: ok/error status on a response wearing its client's color. */
  stroke?: string
}

/**
 * How a packet is painted: in its client's color when the message carries one (requests,
 * messages, events and responses alike; responses add an ok/error outline), otherwise by kind.
 */
export function packetStyle(msg: Pick<Message, 'kind' | 'status' | 'meta'>): PacketStyle {
  const own = msg.meta.clientColor
  if (typeof own !== 'string' || own === '') return { fill: colorFor(msg) }
  return msg.kind === 'response' ? { fill: own, stroke: msg.status === 'ok' ? C.ok : C.err } : { fill: own }
}

/** Cubic ease-in-out on 0..1 (clamped). */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const REQUEST_R = 6
const RESPONSE_R = 5
const SQUARE = 10
const DIAMOND = 7

function createPacketEl(msg: Message): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g')
  const { fill, stroke } = packetStyle(msg)
  let shape: SVGElement
  switch (shapeFor(msg.kind)) {
    case 'square':
      shape = document.createElementNS(SVG_NS, 'rect')
      shape.setAttribute('x', String(-SQUARE / 2))
      shape.setAttribute('y', String(-SQUARE / 2))
      shape.setAttribute('width', String(SQUARE))
      shape.setAttribute('height', String(SQUARE))
      shape.setAttribute('rx', '1.5')
      break
    case 'diamond':
      shape = document.createElementNS(SVG_NS, 'polygon')
      shape.setAttribute('points', `0,${-DIAMOND} ${DIAMOND},0 0,${DIAMOND} ${-DIAMOND},0`)
      break
    default:
      shape = document.createElementNS(SVG_NS, 'circle')
      shape.setAttribute('r', String(msg.kind === 'response' ? RESPONSE_R : REQUEST_R))
  }
  shape.setAttribute('fill', fill)
  if (stroke) {
    shape.setAttribute('stroke', stroke)
    shape.setAttribute('stroke-width', '2')
  }
  g.appendChild(shape)
  g.setAttribute('class', `packet packet-${msg.kind}`)
  return g
}

/**
 * Messages travelling along the edges. Packet positions come from sim time, so pausing freezes
 * them. Drawn imperatively (one rAF callback updating SVG transforms) to stay smooth with
 * MAX_PACKETS in flight; React only renders the empty <svg>.
 */
export function PacketLayer() {
  const api = useSim()
  const store = useStoreApi()
  const rootRef = useRef<SVGGElement>(null)
  const sim = api?.sim
  const onFrame = api?.onFrame

  useEffect(() => {
    if (!sim || !onFrame) return
    let packets: Packet[] = []
    let seq = 0
    const els = new Map<number, SVGGElement>()

    const offSent = sim.on('message:sent', ({ msg, from, to, edgeId, at, duration }) => {
      const edge = edgeId ? useEditor.getState().graph.edges.find((e) => e.id === edgeId) : undefined
      const reverse = edge?.source === to
      packets = packetsReducer(packets, { type: 'sent', packet: { key: ++seq, msg, from, to, reverse, start: at, duration } })
    })

    const offFrame = onFrame(() => {
      const root = rootRef.current
      if (!root) return
      const now = sim.now
      packets = packetsReducer(packets, { type: 'prune', now })
      const { nodeLookup } = store.getState()
      // A packet whose endpoint node was deleted is dropped.
      if (packets.some((p) => !nodeLookup.has(p.from) || !nodeLookup.has(p.to))) {
        packets = packets.filter((p) => nodeLookup.has(p.from) && nodeLookup.has(p.to))
      }
      const live = new Set<number>()
      for (const p of packets) {
        const a = nodeLookup.get(p.from)!
        const b = nodeLookup.get(p.to)!
        if (!a.measured.width || !b.measured.width) continue
        const t = easeInOut((now - p.start) / p.duration)
        const pt = p.reverse
          ? wirePoint(...portPoints(boxOf(b), boxOf(a)), 1 - t)
          : wirePoint(...portPoints(boxOf(a), boxOf(b)), t)
        let el = els.get(p.key)
        if (!el) {
          el = createPacketEl(p.msg)
          root.appendChild(el)
          els.set(p.key, el)
        }
        el.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`)
        live.add(p.key)
      }
      for (const [key, el] of els) {
        if (!live.has(key)) {
          el.remove()
          els.delete(key)
        }
      }
    })

    return () => {
      offSent()
      offFrame()
      for (const el of els.values()) el.remove()
      els.clear()
    }
  }, [sim, onFrame, store])

  return (
    <ViewportPortal>
      <svg className="packet-layer" aria-hidden>
        <g ref={rootRef} />
      </svg>
    </ViewportPortal>
  )
}
