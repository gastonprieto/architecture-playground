import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * The toolbar's `⋯` disclosure: a button that shows a floating panel with the occasional actions.
 * `children` gets `close` so an action can dismiss the panel (toggles such as theme and language leave it open)
 * and the `⋯` button, the element to return focus to once a dialog opened from the panel closes.
 * Closes on Escape (focus goes back to the button) and on a pointer press outside.
 */
export function ToolbarMenu({ label, children }: { label: string; children: (close: () => void, trigger: HTMLButtonElement | null) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const panelId = useId()
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, trigger])

  return (
    <div className="toolbar-menu-wrap" ref={wrapRef}>
      <button
        ref={setTrigger}
        type="button"
        className="toolbar-menu-trigger"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div id={panelId} className="toolbar-menu">
          {children(close, trigger)}
        </div>
      )}
    </div>
  )
}
