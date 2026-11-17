import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useT } from '../i18n'
import { useIslands, type IslandId, type Offset } from './store/islands'

type Box = { left: number; top: number; right: number; bottom: number; width: number }

/** Space kept between a dragged island and the canvas edges. */
const MARGIN = 8
/** How much of an island stays inside the canvas at the bottom, so its grip can be reached. */
const KEEP_VISIBLE = 40
/** Arrow-key step (Shift: ×4). */
const KEY_STEP = 16

/**
 * The offset closest to `want` that keeps the island inside `bounds`: whole horizontally (when it
 * fits) and at least its top `KEEP_VISIBLE` px vertically. `rect` is where it is drawn at `current`.
 */
export function clampOffset(want: Offset, current: Offset, rect: Box, bounds: Box): Offset {
  const baseLeft = rect.left - current.x
  const baseTop = rect.top - current.y
  const minX = bounds.left + MARGIN - baseLeft
  const maxX = Math.max(minX, bounds.right - MARGIN - rect.width - baseLeft)
  const minY = bounds.top + MARGIN - baseTop
  const maxY = Math.max(minY, bounds.bottom - KEEP_VISIBLE - baseTop)
  return { x: Math.min(Math.max(want.x, minX), maxX), y: Math.min(Math.max(want.y, minY), maxY) }
}

const ZERO: Offset = { x: 0, y: 0 }

/**
 * Makes a floating island draggable by a grip at its top. Pass `attach` as the island's ref, put
 * `style` and `className` on it, and and render `grip` first inside it. The offset (from its place in the layout) is kept in
 * store/islands.ts and remembered across reloads; double-click or Home puts it back.
 */
export function useIsland(
  id: IslandId,
  enabled = true,
): { attach: (el: HTMLElement | null) => void; style: CSSProperties; className: string; grip: ReactNode } {
  const t = useT()
  const offset = useIslands((s) => s.offsets[id])
  const front = useIslands((s) => s.front === id)
  const el = useRef<HTMLElement | null>(null)
  const drag = useRef<{ px: number; py: number; from: Offset } | null>(null)
  const [dragging, setDragging] = useState(false)

  /** `want`, kept inside the canvas (the island's offset parent). */
  const fit = useCallback(
    (want: Offset): Offset => {
      const node = el.current
      const parent = node?.offsetParent
      if (!node || !parent) return want
      const current = useIslands.getState().offsets[id] ?? ZERO
      return clampOffset(want, current, node.getBoundingClientRect(), parent.getBoundingClientRect())
    },
    [id],
  )

  /** Pulls the island back inside when the window shrank since it was placed. */
  const refit = useCallback(() => {
    const current = useIslands.getState().offsets[id]
    if (!current) return
    const next = fit(current)
    if (next.x !== current.x || next.y !== current.y) useIslands.getState().move(id, next, true)
  }, [fit, id])

  const attach = useCallback(
    (node: HTMLElement | null) => {
      el.current = node
      if (!node || !enabled) return
      refit()
      window.addEventListener('resize', refit)
      return () => window.removeEventListener('resize', refit)
    },
    [enabled, refit],
  )

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, from: useIslands.getState().offsets[id] ?? ZERO }
    useIslands.getState().raise(id)
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    useIslands.getState().move(id, fit({ x: d.from.x + e.clientX - d.px, y: d.from.y + e.clientY - d.py }))
  }
  const onPointerEnd = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    const current = useIslands.getState().offsets[id]
    if (current) useIslands.getState().move(id, current, true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Home') {
      e.preventDefault()
      useIslands.getState().reset(id)
      return
    }
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!delta) return
    e.preventDefault()
    const current = useIslands.getState().offsets[id] ?? ZERO
    useIslands.getState().raise(id)
    useIslands.getState().move(id, fit({ x: current.x + delta[0], y: current.y + delta[1] }), true)
  }

  if (!enabled) return { attach, style: {}, className: '', grip: null }
  return {
    attach,
    style: { translate: offset ? `${offset.x}px ${offset.y}px` : undefined, zIndex: front ? 12 : undefined },
    className: dragging ? ' dragging' : '',
    grip: (
      <div
        className="island-grip"
        role="button"
        tabIndex={0}
        aria-label={t('islands.move')}
        title={t('islands.move')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={() => useIslands.getState().reset(id)}
        onKeyDown={onKeyDown}
      />
    ),
  }
}
