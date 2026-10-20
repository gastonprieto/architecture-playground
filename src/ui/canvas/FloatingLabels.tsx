import { ViewportPortal, useStoreApi } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import type { NodeId } from '../../engine/types'
import { C, toneColor } from '../colors'
import { useSim } from '../runtime/useSimulation'

/** At most this many labels at once; the oldest go first. */
export const MAX_LABELS = 60
/** Labels on the same node are spread over a small grid of offsets so bursts stay readable. */
const SPREAD_X = [0, -26, 26, -13, 13]
const SPREAD_Y = [0, -9, -4]
/** The same text on the same node is shown at most once per this many real ms (floods stay readable). */
const REPEAT_MS = 120

interface FloatLabel {
  key: number
  text: string
  color: string
  x: number
  y: number
}

/**
 * Short texts that float up and fade over 1 s above a node: drops (code or reason, red), 202s
 * reaching their originator (green) and the components' own node:label texts.
 */
export function FloatingLabels() {
  const api = useSim()
  const store = useStoreApi()
  const sim = api?.sim
  const onFrame = api?.onFrame
  // Labels belong to the simulation that produced them; a reset (new simulation) hides them all.
  const [owned, setOwned] = useState<{ owner: unknown; labels: FloatLabel[] }>({ owner: null, labels: [] })
  const labels = owned.owner === sim ? owned.labels : []

  useEffect(() => {
    if (!sim || !onFrame) return
    let seq = 0
    let buffer: FloatLabel[] = []
    const lastShown = new Map<string, number>()

    const add = (nodeId: NodeId, text: string, color: string) => {
      const n = store.getState().nodeLookup.get(nodeId)
      if (!n?.measured.width) return
      const now = performance.now()
      const id = `${nodeId}|${text}`
      if (now - (lastShown.get(id) ?? -Infinity) < REPEAT_MS) return
      lastShown.set(id, now)
      const key = ++seq
      // Deterministic spread: consecutive labels land at different offsets.
      const dx = SPREAD_X[key % SPREAD_X.length]
      const dy = SPREAD_Y[key % SPREAD_Y.length]
      const { x, y } = n.internals.positionAbsolute
      buffer.push({ key, text, color, x: x + n.measured.width / 2 + dx, y: y - 4 + dy })
      if (buffer.length > MAX_LABELS) buffer = buffer.slice(-MAX_LABELS)
    }

    const offs = [
      sim.on('message:dropped', ({ at, reason, code }) => add(at, String(code ?? reason), C.err)),
      sim.on('message:arrived', ({ msg, at }) => {
        if (msg.kind === 'response' && msg.code === 202 && msg.trail.length === 0) add(at, '202', C.ok)
      }),
      sim.on('node:label', ({ nodeId, text, tone }) => add(nodeId, text, toneColor(tone))),
      onFrame(() => {
        if (buffer.length === 0) return
        const batch = buffer
        buffer = []
        setOwned((prev) => ({
          owner: sim,
          labels: (prev.owner === sim ? [...prev.labels, ...batch] : batch).slice(-MAX_LABELS),
        }))
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [sim, onFrame, store])

  const remove = useCallback(
    (key: number) => setOwned((prev) => ({ ...prev, labels: prev.labels.filter((l) => l.key !== key) })),
    [],
  )

  if (labels.length === 0) return null
  return (
    <ViewportPortal>
      {labels.map((l) => (
        <div key={l.key} className="float-label" style={{ transform: `translate(${l.x}px, ${l.y}px)` }}>
          <span style={{ color: l.color }} onAnimationEnd={() => remove(l.key)}>
            {l.text}
          </span>
        </div>
      ))}
    </ViewportPortal>
  )
}
