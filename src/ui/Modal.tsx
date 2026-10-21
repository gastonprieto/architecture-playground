import { useEffect, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  /** Id of the element that names the dialog. */
  labelledBy: string
  className: string
  style?: CSSProperties
  /** Esc, a backdrop click, or the caller's own close/cancel buttons. */
  onClose(): void
  /** Focus goes back here on close (if still in the page). */
  opener: HTMLElement | null
  /** Focused when the dialog opens. */
  initialFocus: RefObject<HTMLElement | null>
  /** Sees every key first; returning true means it was handled (no Esc/Tab handling by the modal). */
  onKey?(e: globalThis.KeyboardEvent): boolean
  children: ReactNode
}

/**
 * Modal dialog shell shared by the info panel and the behavior editor. While open it owns the
 * keyboard: a document-level capture listener sees every key first, wherever focus is (even on the
 * body after a click on the dialog's text). Esc closes, Tab cycles inside the dialog, and nothing
 * reaches the app's shortcuts (Space, Delete, +/-, undo…). Default actions still happen (typing,
 * Enter/Space on buttons). The app behind it is made `inert` by App.
 */
export function Modal({ labelledBy, className, style, onClose, opener, initialFocus, onKey, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const downOnBackdrop = useRef(false)
  // Latest callbacks, so the listener is installed once for the dialog's lifetime.
  const latest = useRef({ onClose, onKey })
  useLayoutEffect(() => {
    latest.current = { onClose, onKey }
  })

  useEffect(() => {
    initialFocus.current?.focus()
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const panel = panelRef.current
      e.stopPropagation()
      if (!panel) return
      if (latest.current.onKey?.(e)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        latest.current.onClose()
      } else if (e.key === 'Tab') {
        const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (!panel.contains(active)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (opener?.isConnected) opener.focus()
    }
    // Mount/unmount only: the opener and the first focus are fixed when the dialog opens.
    // `opener` and `initialFocus` are fixed for the dialog's lifetime: this runs on open and close only.
  }, [opener, initialFocus])

  // Only a click that starts and ends on the backdrop closes (not a text selection dragged out of the dialog).
  const onBackdropDown = (e: MouseEvent) => {
    downOnBackdrop.current = e.target === e.currentTarget
  }
  const onBackdropClick = (e: MouseEvent) => {
    if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
    downOnBackdrop.current = false
  }

  return (
    <div className="info-backdrop" onMouseDown={onBackdropDown} onClick={onBackdropClick}>
      <div className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={panelRef} style={style}>
        {children}
      </div>
    </div>
  )
}
