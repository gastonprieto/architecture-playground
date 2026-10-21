import { useId, useLayoutEffect, useRef, useState } from 'react'
import { defaultRegistry } from '../components/index'
import type { NodeId } from '../engine/types'
import { useLang, useT } from '../i18n'
import { componentLabel } from '../i18n/componentText'
import { behaviorExample, dslErrorLine, referenceRows } from './behaviorText'
import { toneColor } from './colors'
import { applyEdit, dslKeyEdit, type TextEdit } from './dslKeys'
import { Modal } from './Modal'
import { useBehaviorEditor } from './store/behaviorEditor'
import { useEditor } from './store/editor'
import { useBehaviorStatus } from './useBehaviorStatus'

/** DSL reference: keyword table, notes and the spec example. Shown in the editor and in the ⓘ panel. */
export function BehaviorReference() {
  const lang = useLang((s) => s.lang)
  const t = useT()
  return (
    <div className="dsl-ref-body">
      <table className="dsl-ref-table">
        <caption>{t('behavior.ref.keywords')}</caption>
        <tbody>
          {referenceRows(lang).map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <code>{r.syntax}</code>
              </th>
              <td>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dsl-ref-notes">{t('behavior.ref.notes')}</p>
      <h4>{t('behavior.ref.example')}</h4>
      <pre className="dsl-ref-example">{t('behavior.ref.exampleText')}</pre>
    </div>
  )
}

/**
 * Put `edit` into the textarea through the browser's editing commands when available, so the
 * textarea's own undo (Ctrl/Cmd+Z) keeps working; otherwise set the text directly.
 */
function applyToTextarea(ta: HTMLTextAreaElement, edit: TextEdit, setText: (text: string) => void): void {
  const expected = applyEdit(ta.value, edit)
  ta.setSelectionRange(edit.from, edit.to)
  let done = false
  try {
    done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.insert)
  } catch {
    done = false
  }
  if (!done || ta.value !== expected) setText(expected)
}

function EditorPanel({ nodeId }: { nodeId: NodeId }) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === nodeId))
  const updateNodeConfig = useEditor((s) => s.updateNodeConfig)
  const close = useBehaviorEditor((s) => s.close)
  const [opener] = useState(() => useBehaviorEditor.getState().opener)
  const lang = useLang((s) => s.lang)
  const t = useT()
  const titleId = useId()
  const errorsId = useId()
  const initial = typeof node?.config.behavior === 'string' ? node.config.behavior : ''
  const [text, setText] = useState(initial)
  const status = useBehaviorStatus(nodeId, text)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  /** Selection to restore after the next render (a key edit or an inserted example). */
  const pendingSel = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    if (pendingSel.current) {
      ta.setSelectionRange(...pendingSel.current)
      pendingSel.current = null
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }, [text])

  if (!node) return null
  const def = defaultRegistry.get(node.type)
  const configName = typeof node.config.name === 'string' ? node.config.name.trim() : ''
  const name = configName || componentLabel(lang, node.type, def)

  const save = () => {
    // Saving the same text adds no undo step; a change is always its own step (no coalescing).
    if (text !== initial) updateNodeConfig(nodeId, { behavior: text }, { coalesce: false })
    close()
  }

  const insertExample = () => {
    const example = behaviorExample(lang, node.type)
    const next = text.trim() === '' ? example : `${text.replace(/\n*$/, '\n')}\n${example}`
    pendingSel.current = [next.length, next.length]
    setText(next)
    taRef.current?.focus()
  }

  // Tab/Shift+Tab/Enter in the code edit indentation (the modal sees keys first, so they are handled here).
  const onKey = (e: globalThis.KeyboardEvent): boolean => {
    const ta = taRef.current
    if (!ta || e.target !== ta || e.isComposing) return false
    if (e.key !== 'Tab' && e.key !== 'Enter') return false
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
  const errorLines = new Set(status.kind === 'errors' ? status.errors.map((e) => e.line) : [])

  return (
    <Modal
      className="info-panel dsl-dialog"
      labelledBy={titleId}
      onClose={close}
      opener={opener}
      initialFocus={taRef}
      onKey={onKey}
      style={{ ['--node-color' as string]: def ? toneColor(def.color) : 'var(--line)' }}
    >
      <header className="info-head">
        <span className="info-icon" aria-hidden>
          {def?.icon ?? '❓'}
        </span>
        <h2 id={titleId}>{t('behavior.title', { name })}</h2>
        <button type="button" className="info-close" aria-label={t('info.close')} title={t('info.close')} onClick={close}>
          ✕
        </button>
      </header>
      <div className="dsl-main">
        <div className="dsl-left">
          <div className={`dsl-code${status.kind === 'errors' ? ' has-errors' : ''}`}>
            <div className="dsl-gutter" ref={gutterRef} aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <span key={i} className={errorLines.has(i + 1) ? 'err' : undefined}>
                  {i + 1}
                </span>
              ))}
            </div>
            <textarea
              ref={taRef}
              aria-label={t('behavior.editor')}
              className="dsl-textarea"
              value={text}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              aria-describedby={errorsId}
              aria-invalid={status.kind === 'errors'}
              onChange={(e) => setText(e.target.value)}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
              }}
            />
          </div>
          <div id={errorsId} className="dsl-status" role="status">
            {status.kind === 'errors' ? (
              <>
                <p className="dsl-status-head err">{t('behavior.errorsTitle')}</p>
                <ul className="dsl-errors">
                  {status.errors.map((err, i) => (
                    <li key={i}>{dslErrorLine(lang, err)}</li>
                  ))}
                </ul>
              </>
            ) : status.kind === 'active' ? (
              <p className="dsl-status-head ok">{t('behavior.ok')}</p>
            ) : (
              <p className="dsl-status-head">{t('behavior.empty')}</p>
            )}
          </div>
        </div>
        <aside className="dsl-ref" aria-labelledby={`${titleId}-ref`}>
          <h3 id={`${titleId}-ref`}>{t('behavior.ref.title')}</h3>
          <BehaviorReference />
        </aside>
      </div>
      <footer className="dsl-actions">
        <button type="button" onClick={insertExample}>
          {t('behavior.insertExample')}
        </button>
        <span className="dsl-actions-gap" />
        <button type="button" onClick={close}>
          {t('behavior.cancel')}
        </button>
        <button type="button" className="primary" onClick={save}>
          {t('behavior.save')}
        </button>
      </footer>
    </Modal>
  )
}

/** The behavior editor popup, open while `useBehaviorEditor.nodeId` is set. */
export function BehaviorEditorDialog() {
  const nodeId = useBehaviorEditor((s) => s.nodeId)
  return nodeId === null ? null : <EditorPanel key={nodeId} nodeId={nodeId} />
}
