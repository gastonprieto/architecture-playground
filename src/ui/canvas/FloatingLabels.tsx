import { ViewportPortal, useStoreApi } from '@xyflow/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeId } from '../../engine/types'
import { codeText, useLang } from '../../i18n'
import { C, toneColor } from '../colors'
import { useSim } from '../runtime/useSimulation'
import { LabelBook } from './labelBook'

/** At most this many labels at once; the oldest go first. */
export const MAX_LABELS = 60
/** Vertical distance between stacked labels of one node; past STACK_ROWS they continue in a new column. */
const STACK_DY = 15
const STACK_ROWS = 4
const STACK_DX = 34

interface FloatLabel {
  key: number
  text: string
  color: string
  x: number
  y: number
  /** How many times the text fired while this label was collecting repeats. */
  count: number
}

/** Offset of stacking slot `slot`: rows upward, then alternating columns right/left. */
function slotOffset(slot: number): { dx: number; dy: number } {
  const col = Math.floor(slot / STACK_ROWS)
  const side = col === 0 ? 0 : (col % 2 === 1 ? 1 : -1) * Math.ceil(col / 2)
  return { dx: side * STACK_DX, dy: -(slot % STACK_ROWS) * STACK_DY }
}

/**
 * Short texts that float up and fade over 1 s above a node: drops (status code, or the translated
 * reason code, red) and the components' own node:label codes, translated (e.g. the 202 at a queue
 * or broker). Repeats of a text on a node within REPEAT_MS bump a "×N" counter instead of stacking up; different texts get their own slot.
 */
export function FloatingLabels() {
  const api = useSim()
  const store = useStoreApi()
  const sim = api?.sim
  const onFrame = api?.onFrame
  // Labels belong to the simulation that produced them; a reset (new simulation) hides them all.
  const [owned, setOwned] = useState<{ owner: unknown; labels: FloatLabel[] }>({ owner: null, labels: [] })
  const labels = owned.owner === sim ? owned.labels : []
  const bookRef = useRef<LabelBook | null>(null)

  useEffect(() => {
    if (!sim || !onFrame) return
    const book = new LabelBook()
    bookRef.current = book
    let buffer: FloatLabel[] = []
    const bumps = new Map<number, number>()

    const add = (nodeId: NodeId, text: string, color: string) => {
      const n = store.getState().nodeLookup.get(nodeId)
      if (!n?.measured.width) return
      const r = book.add(nodeId, text, performance.now())
      if (r.type === 'bump') {
        bumps.set(r.key, r.count)
        return
      }
      const { dx, dy } = slotOffset(r.slot)
      const { x, y } = n.internals.positionAbsolute
      buffer.push({ key: r.key, text, color, x: x + n.measured.width / 2 + dx, y: y - 4 + dy, count: 1 })
    }

    const offs = [
      // Labels are translated when they appear; ones already floating keep their language.
      sim.on('message:dropped', ({ at, reason, code }) =>
        add(at, code !== undefined ? String(code) : codeText(useLang.getState().lang, 'reasons', reason), C.err),
      ),
      sim.on('node:label', ({ nodeId, text, tone }) => add(nodeId, codeText(useLang.getState().lang, 'labels', text), toneColor(tone))),
      onFrame(() => {
        if (buffer.length === 0 && bumps.size === 0) return
        const batch = buffer
        const counts = new Map(bumps)
        buffer = []
        bumps.clear()
        setOwned((prev) => {
          const all = (prev.owner === sim ? [...prev.labels, ...batch] : batch).map((l) =>
            counts.has(l.key) ? { ...l, count: counts.get(l.key)! } : l,
          )
          const dropped = all.length - MAX_LABELS
          if (dropped > 0) for (const l of all.slice(0, dropped)) book.remove(l.key)
          return { owner: sim, labels: dropped > 0 ? all.slice(dropped) : all }
        })
      }),
    ]
    return () => {
      for (const off of offs) off()
      book.clear()
    }
  }, [sim, onFrame, store])

  const remove = useCallback((key: number) => {
    bookRef.current?.remove(key)
    setOwned((prev) => ({ ...prev, labels: prev.labels.filter((l) => l.key !== key) }))
  }, [])

  const reduced = useReducedMotion()
  if (labels.length === 0) return null
  return (
    <ViewportPortal>
      <AnimatePresence>
        {labels.map((l) => (
          <div key={l.key} className="float-label" style={{ transform: `translate(${l.x}px, ${l.y}px)` }}>
            <motion.span
              style={{ color: l.color }}
              initial={{ opacity: 0, x: '-50%', y: '-100%' }}
              animate={{ opacity: 1, x: '-50%', y: reduced ? '-100%' : 'calc(-100% - 24px)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 1, ease: 'easeOut' }}
              onAnimationComplete={() => remove(l.key)}
            >
              {l.count > 1 ? `${l.text} ×${l.count}` : l.text}
            </motion.span>
          </div>
        ))}
      </AnimatePresence>
    </ViewportPortal>
  )
}
