import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
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
  const downOnBackdrop = useRef(false)
  const def = defaultRegistry.get(type)
  const label = def ? componentLabel(lang, type, def) : type
  const info = def ? componentInfo(lang, def) : undefined

  useEffect(() => closeRef.current?.focus(), [])

  // Keys stay inside the dialog: Esc closes, Tab cycles, and the app shortcuts (Space, Delete…) don't fire.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

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
        onKeyDown={onKeyDown}
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
