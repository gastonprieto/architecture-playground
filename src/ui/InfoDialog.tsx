import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react'
import { defaultRegistry } from '../components/index'
import { useLang, useT } from '../i18n'
import { componentInfo, componentLabel } from '../i18n/componentText'
import { toneColor } from './colors'
import { useInfoPanel } from './store/infoPanel'

/** Info text with `code` spans (status codes, paths) shown in the mono font. */
function rich(text: string): ReactNode {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function InfoPanel({ type }: { type: string }) {
  const lang = useLang((s) => s.lang)
  const t = useT()
  const close = useInfoPanel((s) => s.close)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const downOnBackdrop = useRef(false)
  const def = defaultRegistry.get(type)
  const label = def ? componentLabel(lang, type, def) : type
  const info = def ? componentInfo(lang, def) : undefined

  // While open, the dialog owns the keyboard: a document-level capture listener sees every key first,
  // wherever focus is (even on the body after a click on the panel's text). Esc closes, Tab cycles
  // inside the panel, and nothing reaches the app's shortcuts (Space, Delete, +/-, undo…). Default
  // actions still happen, so Enter/Space on the ✕ button work. Focus returns to the opener on close.
  useEffect(() => {
    const opener = useInfoPanel.getState().opener
    closeRef.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      const panel = panelRef.current
      e.stopPropagation()
      if (!panel) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
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
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (opener?.isConnected) opener.focus()
    }
  }, [close])

  // Only a click that starts and ends on the backdrop closes (not a text selection dragged out of the panel).
  const onBackdropDown = (e: MouseEvent) => {
    downOnBackdrop.current = e.target === e.currentTarget
  }
  const onBackdropClick = (e: MouseEvent) => {
    if (downOnBackdrop.current && e.target === e.currentTarget) close()
    downOnBackdrop.current = false
  }

  return (
    <div className="info-backdrop" onMouseDown={onBackdropDown} onClick={onBackdropClick}>
      <div
        className="info-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        style={{ ['--node-color' as string]: def ? toneColor(def.color) : 'var(--line)' }}
      >
        <header className="info-head">
          <span className="info-icon" aria-hidden>
            {def?.icon ?? '❓'}
          </span>
          <h2 id={titleId}>{label}</h2>
          <button ref={closeRef} type="button" className="info-close" aria-label={t('info.close')} title={t('info.close')} onClick={close}>
            ✕
          </button>
        </header>
        {info ? (
          <div className="info-body">
            <p className="info-summary">{rich(info.summary)}</p>
            <h3>{t('info.behavior')}</h3>
            <ul className="info-behavior">
              {info.behavior.map((b, i) => (
                <li key={i}>{rich(b)}</li>
              ))}
            </ul>
            {info.fields.length > 0 && (
              <>
                <h3>{t('info.fields')}</h3>
                <dl className="info-fields">
                  {info.fields.map((f) => (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      {f.help && <dd>{rich(f.help)}</dd>}
                    </div>
                  ))}
                </dl>
              </>
            )}
            <p className="info-tip">
              <strong>{t('info.tip')}</strong> {rich(info.tip)}
            </p>
          </div>
        ) : (
          <p className="info-none">{t('info.none')}</p>
        )}
      </div>
    </div>
  )
}

/** "How it works" modal for a component type; opened from the palette and inspector ⓘ buttons. */
export function InfoDialog() {
  const type = useInfoPanel((s) => s.type)
  return type === null ? null : <InfoPanel key={type} type={type} />
}

/** The ⓘ button that opens the info panel for `type`. */
export function InfoButton({ type, label }: { type: string; label: string }) {
  const t = useT()
  const open = useInfoPanel((s) => s.open)
  const text = t('info.open', { label })
  return (
    <button type="button" className="info-btn" aria-label={text} title={text} onClick={(e) => open(type, e.currentTarget)}>
      ⓘ
    </button>
  )
}
