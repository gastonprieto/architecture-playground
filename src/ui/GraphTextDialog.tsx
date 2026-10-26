import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLang, useT } from '../i18n'
import { parseAnyGraph } from '../persistence/importText'
import { applyToTextarea } from './applyToTextarea'
import { dslKeyEdit } from './dslKeys'
import { graphDslErrorLine } from './graphDslText'
import { GraphReference } from './GraphReference'
import { Modal } from './Modal'
import type { SimApi } from './runtime/useSimulation'
import { useGraphText } from './store/graphText'
import { useLoadGraph } from './useLoadGraph'

function TextPanel({ api, initial }: { api: SimApi; initial: string }) {
  const close = useGraphText((s) => s.close)
  const [opener] = useState(() => useGraphText.getState().opener)
  const lang = useLang((s) => s.lang)
  const t = useT()
  const load = useLoadGraph(api)
  const titleId = useId()
  const errorsId = useId()
  const [text, setText] = useState(initial)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  /** Selection to restore after the next render (a key edit). */
  const pendingSel = useRef<[number, number] | null>(null)

  const result = useMemo(() => parseAnyGraph(text), [text])
  const errors = useMemo(() => {
    if (result.ok) return []
    if (result.format === 'dsl') return result.errors.map((e) => ({ line: e.line, text: graphDslErrorLine(lang, e) }))
    const e = result.error
    return [{ line: 0, text: t(`errors.${e.error}`, e.error === 'dangling-edge' ? { edgeId: e.edgeId } : undefined) }]
  }, [result, lang, t])

  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    if (pendingSel.current) {
      ta.setSelectionRange(...pendingSel.current)
      pendingSel.current = null
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }, [text])

  const apply = () => {
    if (!result.ok) return
    load(result.graph)
    close()
  }

  // The modal sees keys first, so the editor's own keys are handled here.
  const onKey = (e: globalThis.KeyboardEvent): boolean => {
    const ta = taRef.current
    if (!ta || e.isComposing) return false
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      apply()
      return true
    }
    if (e.target !== ta || (e.key !== 'Tab' && e.key !== 'Enter')) return false
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key === 'Enter' && e.shiftKey)) return false
    e.preventDefault()
    const edit = dslKeyEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.key, e.shiftKey)
    if (edit) {
      pendingSel.current = [edit.selStart, edit.selEnd]
      applyToTextarea(ta, edit, setText)
      ta.setSelectionRange(edit.selStart, edit.selEnd)
    }
    return true
  }

  const lineCount = text.split('\n').length
  const errorLines = new Set(errors.map((e) => e.line))

  return (
    <Modal
      className="info-panel dsl-dialog"
      labelledBy={titleId}
      onClose={close}
      // A stray click outside must not throw edits away: the backdrop closes only an unchanged text.
      onBackdrop={() => {
        if (text === initial) close()
      }}
      opener={opener}
      initialFocus={taRef}
      onKey={onKey}
    >
      <header className="info-head">
        <h2 id={titleId}>{t('graphText.title')}</h2>
        <button type="button" className="info-close" aria-label={t('info.close')} title={t('info.close')} onClick={close}>
          ✕
        </button>
      </header>
      <div className="dsl-main">
        <div className="dsl-left">
          <div className={`dsl-code${errors.length > 0 ? ' has-errors' : ''}`}>
            <div className="dsl-gutter" ref={gutterRef} aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <span key={i} className={errorLines.has(i + 1) ? 'err' : undefined}>
                  {i + 1}
                </span>
              ))}
            </div>
            <textarea
              ref={taRef}
              aria-label={t('graphText.title')}
              className="dsl-textarea"
              value={text}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              aria-describedby={errorsId}
              aria-invalid={errors.length > 0}
              onChange={(e) => setText(e.target.value)}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
              }}
            />
          </div>
          <p className="dsl-hint">{t('graphText.hint')}</p>
          <div id={errorsId} className="dsl-status">
            {errors.length > 0 && (
              <ul className="dsl-errors">
                {errors.map((err, i) => (
                  <li key={i}>{err.text}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <aside className="dsl-ref" aria-labelledby={`${titleId}-ref`}>
          <h3 id={`${titleId}-ref`}>{t('graphText.ref.title')}</h3>
          <GraphReference />
        </aside>
      </div>
      <footer className="dsl-actions">
        <span className="dsl-actions-gap" />
        <button type="button" onClick={close}>
          {t('graphText.cancel')}
        </button>
        <button type="button" className="primary" disabled={!result.ok} onClick={apply}>
          {t('graphText.apply')}
        </button>
      </footer>
    </Modal>
  )
}

/** The "Texto" popup, open while `useGraphText.text` is set. */
export function GraphTextDialog({ api }: { api: SimApi }) {
  const text = useGraphText((s) => s.text)
  return text === null ? null : <TextPanel api={api} initial={text} />
}
