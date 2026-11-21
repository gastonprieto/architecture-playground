import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Graph } from '../engine/types'
import { useT } from '../i18n'
import { track } from './analytics'
import { Icon } from './Icon'
import { rich } from './richText'
import { useRuntime } from './runtime/runtimeStore'
import { useEditor } from './store/editor'
import { useInspectorTab } from './store/inspectorTab'
import { useScenario } from './store/scenario'
import { useTour } from './store/tour'
import { placeCard, type Side } from './tourPlacement'

/**
 * Places the tutorial points at: `data-tour="<id>"` on the element (kept as attributes rather than
 * class names so restyling a panel does not break the tutorial), or `nodes`, the box around every
 * component on the canvas (the canvas itself fills the window, so lighting it would light everything).
 */
export type TourTarget = 'palette' | 'nodes' | 'inspector' | 'metrics' | 'play' | 'scenarios'

/** Measured on every step: the card never covers it. */
type Measured = TourTarget | 'toolbar'

/** Where the card would rather sit: on `side` of a target. */
interface Placement {
  target: TourTarget
  side: Side
}

interface Step {
  id: string
  /** Areas left lit by the spotlight; the rest of the page is dimmed. None: everything dimmed. */
  spotlight: readonly TourTarget[]
  /** Card placements in order of preference (see placeCard); none: centered. */
  anchor?: readonly Placement[]
  /**
   * An action step: it advances by itself once this holds, compared with the graph at the moment the
   * step opened. Steps without it advance with the "Next" button.
   */
  done?: (base: Graph) => boolean
}

/** True when some node that existed when the step opened has had its config edited since. */
const configEdited = (base: Graph): boolean => {
  const before = new Map(base.nodes.map((n) => [n.id, n.config]))
  return useEditor.getState().graph.nodes.some((n) => before.has(n.id) && before.get(n.id) !== n.config)
}

const STEPS: readonly Step[] = [
  { id: 'welcome', spotlight: [] },
  {
    id: 'add',
    spotlight: ['palette', 'nodes'],
    anchor: [{ target: 'palette', side: 'right' }],
    done: (base) => useEditor.getState().graph.nodes.length > base.nodes.length,
  },
  {
    id: 'connect',
    spotlight: ['nodes'],
    anchor: [{ target: 'nodes', side: 'bottom' }],
    done: (base) => useEditor.getState().graph.edges.length > base.edges.length,
  },
  {
    id: 'configure',
    spotlight: ['nodes', 'inspector'],
    // The inspector only shows with a selection: until then the card sits by the components.
    anchor: [
      { target: 'inspector', side: 'bottom' },
      { target: 'nodes', side: 'bottom' },
    ],
    done: configEdited,
  },
  { id: 'play', spotlight: ['play'], anchor: [{ target: 'play', side: 'bottom' }], done: () => useRuntime.getState().playing },
  { id: 'metrics', spotlight: ['metrics'], anchor: [{ target: 'metrics', side: 'top' }] },
  {
    id: 'scenarios',
    spotlight: ['scenarios'],
    anchor: [{ target: 'scenarios', side: 'bottom' }],
    done: () => useScenario.getState().pickerOpen,
  },
]

/** How long a finished action step shows its check mark before moving on. */
const DONE_MS = 700
/** Room between a lit element and the edge of its hole in the dim layer (more around the components). */
const PAD = 6
const NODES_PAD = 18

interface Hole {
  id: Measured
  x: number
  y: number
  w: number
  h: number
}

/** The viewport box of a target, padded, or null when it is not on screen. */
function measure(id: Measured): Hole | null {
  const selector = id === 'nodes' ? '.react-flow__node' : id === 'toolbar' ? '.toolbar' : `[data-tour="${id}"]`
  const rects = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect())
  const visible = rects.filter((r) => r.width > 0 && r.height > 0)
  if (visible.length === 0) return null
  const pad = id === 'nodes' ? NODES_PAD : PAD
  const left = Math.min(...visible.map((r) => r.left))
  const top = Math.min(...visible.map((r) => r.top))
  const right = Math.max(...visible.map((r) => r.right))
  const bottom = Math.max(...visible.map((r) => r.bottom))
  return { id, x: Math.round(left - pad), y: Math.round(top - pad), w: Math.round(right - left + 2 * pad), h: Math.round(bottom - top + 2 * pad) }
}

/**
 * The boxes of the given targets, followed every frame while the tutorial is open: panels are
 * movable islands, the inspector comes and goes with the selection, components are dragged and the
 * canvas is panned and zoomed.
 */
function useBoxes(ids: readonly Measured[]): Hole[] {
  const [boxes, setBoxes] = useState<Hole[]>([])
  const key = ids.join(' ')
  useEffect(() => {
    if (!key || typeof requestAnimationFrame === 'undefined') return
    let raf = 0
    let last = ''
    const tick = () => {
      const next = (key.split(' ') as Measured[]).map(measure).filter((b) => b !== null)
      const sig = JSON.stringify(next)
      if (sig !== last) {
        last = sig
        setBoxes(next)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [key])
  // A step with nothing to measure (or a paused tutorial) has no boxes.
  return key ? boxes : []
}

/**
 * Dims the page except the lit targets, with a ring around each. It lets every click through: the
 * tutorial asks the user to do things in the app, so nothing may be blocked.
 */
function Spotlight({ holes }: { holes: Hole[] }) {
  const reduced = useReducedMotion()
  const transition = { duration: reduced ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] as const }
  const box = (h: Hole) => ({ x: h.x, y: h.y, width: h.w, height: h.h })
  return (
    <svg className="tour-spotlight" aria-hidden="true">
      <defs>
        <mask id="tour-mask">
          <rect width="100%" height="100%" fill="white" />
          <AnimatePresence>
            {holes.map((h) => (
              <motion.rect
                key={h.id}
                rx={12}
                fill="black"
                initial={{ ...box(h), opacity: 0 }}
                animate={{ ...box(h), opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition}
              />
            ))}
          </AnimatePresence>
        </mask>
      </defs>
      <rect className="tour-dim" width="100%" height="100%" mask="url(#tour-mask)" />
      <AnimatePresence>
        {holes.map((h) => (
          <motion.rect
            key={h.id}
            className="tour-ring"
            rx={12}
            initial={{ ...box(h), opacity: 0 }}
            animate={{ ...box(h), opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          />
        ))}
      </AnimatePresence>
    </svg>
  )
}

/**
 * Interactive first-visit tutorial: each step lights up one part of the app (spotlight) and asks the
 * user to do something there; action steps advance on their own when it is done. The card is a
 * manual popover placed next to its target, clear of the toolbar and of what the step lights up
 * (placeCard). `paused` hides it while a dialog is open; the step is kept.
 */
export function Tour({ paused }: { paused: boolean }) {
  const t = useT()
  const index = useTour((s) => s.step)
  const step = index === null ? undefined : STEPS[index]
  const [doneId, setDoneId] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const measured: Measured[] = step && !paused ? [...new Set([...step.spotlight, ...(step.anchor ?? []).map((a) => a.target), 'toolbar' as const])] : []
  const boxes = useBoxes(measured)
  const holes = boxes.filter((b) => step?.spotlight.includes(b.id as TourTarget))
  // The card's size, measured once it is on screen (the copy changes its height).
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const read = () =>
      setCardSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [step, paused])
  const box = (id: Measured) => boxes.find((b) => b.id === id)
  const candidates = (step?.anchor ?? []).flatMap((a) => {
    const anchor = box(a.target)
    return anchor ? [{ anchor, side: a.side }] : []
  })
  const toolbar = box('toolbar')
  const placed =
    cardSize.w > 0 && candidates.length > 0
      ? placeCard({
          candidates,
          card: cardSize,
          viewport: { w: window.innerWidth, h: window.innerHeight },
          avoid: toolbar ? [toolbar] : [],
          avoidIfPossible: holes,
        })
      : null
  // The card stays where it first lands in each step: dragging components, panning or the inspector
  // showing up do not move it. It moves again on the next step, or when the window is resized.
  const [lock, setLock] = useState<{ step: number; x: number; y: number } | null>(null)
  const locked = lock !== null && lock.step === index ? lock : null
  // Adjusting state while rendering (React's pattern for derived state): runs once per step.
  if (!locked && placed && index !== null) setLock({ step: index, x: placed.x, y: placed.y })
  useEffect(() => {
    const reset = () => setLock(null)
    window.addEventListener('resize', reset)
    return () => window.removeEventListener('resize', reset)
  }, [])
  const at = locked ?? placed

  const next = () => {
    const i = useTour.getState().step
    if (i === null) return
    if (i + 1 < STEPS.length) useTour.getState().go(i + 1)
    else {
      track({ name: 'tour_finished', props: { step: STEPS[i].id } })
      useTour.getState().finish()
    }
  }
  const skip = () => {
    const i = useTour.getState().step
    track({ name: 'tour_skipped', props: { step: i === null ? 'none' : STEPS[i].id } })
    useTour.getState().finish()
  }
  // The latest `next`, so store subscriptions below are installed once per step.
  const nextRef = useRef(next)
  useLayoutEffect(() => {
    nextRef.current = next
  })

  // The values to change are on the inspector's Configuración tab: open it there for that step.
  useEffect(() => {
    if (step?.id === 'configure') useInspectorTab.getState().setTab('config')
  }, [step])

  // Action steps: watch the stores until the step's goal holds, show the check mark, then move on.
  useEffect(() => {
    if (!step?.done) return
    const done = step.done
    const base = useEditor.getState().graph
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (timer !== undefined || !done(base)) return
      // Opening the scenario picker ends the tutorial at once: the dialog takes over.
      if (step.id === 'scenarios') {
        nextRef.current()
        return
      }
      setDoneId(step.id)
      timer = setTimeout(() => nextRef.current(), DONE_MS)
    }
    const unsubs = [useEditor.subscribe(check), useRuntime.subscribe(check), useScenario.subscribe(check)]
    check()
    return () => {
      unsubs.forEach((u) => u())
      clearTimeout(timer)
    }
  }, [step])

  // Open the popover (top layer, above every island) and move focus into it for screen readers.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || paused) return
    try {
      if (!el.matches(':popover-open')) el.showPopover()
    } catch {
      /* no Popover API: the card still shows as a fixed element (see playground.css) */
    }
    el.focus({ preventScroll: true })
  }, [step, paused])

  if (!step || paused || index === null) return null
  const isDone = doneId === step.id
  const last = index === STEPS.length - 1
  const style: CSSProperties | undefined = at ? { left: at.x, top: at.y, right: 'auto', bottom: 'auto', margin: 0 } : undefined

  return (
    <>
      <Spotlight holes={holes} />
      <div
        ref={cardRef}
        // A manual popover stays open while the user clicks around the app to do what the step asks.
        popover="manual"
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className={`tour-step${at ? ' placed' : ''}`}
        data-step={step.id}
        style={style}
        // Esc closes the tutorial while the card has focus (the app's own Esc uses stay untouched).
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          skip()
        }}
      >
        <div className="tour-progress" aria-label={t('tour.progress', { i: index + 1, n: STEPS.length })}>
          {STEPS.map((s, i) => (
            <span key={s.id} className={i < index ? 'past' : i === index ? 'current' : undefined} />
          ))}
        </div>
        <h2 id="tour-title">{t(`tour.steps.${step.id}.title`)}</h2>
        <p id="tour-body">{rich(t(`tour.steps.${step.id}.body`))}</p>
        {step.done && (
          <p className={`tour-task${isDone ? ' done' : ''}`} role="status">
            <Icon name={isDone ? 'ok' : 'your-turn'} size={15} />
            {isDone ? t('tour.done') : t('tour.yourTurn')}
          </p>
        )}
        <footer className="tour-actions">
          {!last && (
            <button type="button" className="tour-skip" onClick={skip}>
              {t('tour.skip')}
            </button>
          )}
          <button type="button" className={step.done && !last ? 'tour-next subtle' : 'tour-next primary'} onClick={next}>
            {index === 0 ? t('tour.start') : last ? t('tour.finish') : step.done ? t('tour.skipStep') : t('tour.next')}
          </button>
        </footer>
      </div>
    </>
  )
}
