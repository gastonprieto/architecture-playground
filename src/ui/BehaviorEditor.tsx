import { useId, useLayoutEffect, useRef, useState } from 'react'
import { parseBehavior } from '../components/behavior'
import { defaultRegistry } from '../components/index'
import type { NodeId } from '../engine/types'
import { useLang, useT } from '../i18n'
import { componentLabel } from '../i18n/componentText'
import { behaviorExample, behaviorSummary, dslErrorLine } from './behaviorText'
import { BehaviorReference } from './BehaviorReference'
import { toneColor } from './colors'
import { applyEdit, dslKeyEdit, type TextEdit } from './dslKeys'
import { Modal } from './Modal'
import { useBehaviorEditor } from './store/behaviorEditor'
import { useEditor } from './store/editor'
import { useBehaviorStatus } from './useBehaviorStatus'

/**
 * Put `edit` into the textarea through the browser's editing commands when available, so the
 * textarea's own undo (Ctrl/Cmd+Z) keeps working; otherwise set the text directly.
 */
function applyToTextarea(ta: HTMLTextAreaElement, edit: TextEdit, setText: (text: string) => void): void {
  const expected = applyEdit(ta.value, edit)
  ta.focus()
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
  /** Tab indents in the code (default); Ctrl+M switches it to moving focus, so the keyboard can leave. */
  const [tabIndents, setTabIndents] = useState(true)
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
    const ta = taRef.current
    if (!ta) return
    const example = behaviorExample(lang, node.type)
    // Through the textarea's editing path, so Ctrl/Cmd+Z in the code undoes it.
    const from = text.trim() === '' ? 0 : /\n*$/.exec(text)!.index
    const insert = from === 0 ? example : `\n\n${example}`
    const caret = from + insert.length
    const edit: TextEdit = { from, to: text.length, insert, selStart: caret, selEnd: caret }
    pendingSel.current = [caret, caret]
    applyToTextarea(ta, edit, setText)
    ta.setSelectionRange(caret, caret)
  }

  // The modal sees keys first, so the editor's own keys are handled here.
  const onKey = (e: globalThis.KeyboardEvent): boolean => {
    const ta = taRef.current
    if (!ta || e.isComposing) return false
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
      return true
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      setTabIndents((v) => !v)
      return true
    }
    // Tab/Shift+Tab/Enter in the code edit indentation.
    if (e.target !== ta || (e.key !== 'Tab' && e.key !== 'Enter')) return false
    if (e.key === 'Tab' && !tabIndents) return false
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

  // A valid DSL with no handler for what this type receives acks everything without doing anything.
  const missingKey =
    status.kind !== 'active'
      ? null
      : node.type === 'worker' && !parseBehavior(text).program.handlers.some((h) => h.on === 'message')
        ? 'behavior.noMessageHandler'
        : node.type === 'subscriber' && !parseBehavior(text).program.handlers.some((h) => h.on === 'event')
          ? 'behavior.noEventHandler'
          : null

  const lineCount = text.split('\n').length
  const errorLines = new Set(status.kind === 'errors' ? status.errors.map((e) => e.line) : [])

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
          <p className="dsl-hint">{t(tabIndents ? 'behavior.hintIndent' : 'behavior.hintFocus')}</p>
          <p className="sr-only" aria-live="polite">
            {status.kind === 'errors' ? behaviorSummary(lang, status) : t(status.kind === 'active' ? 'behavior.ok' : 'behavior.empty')}
          </p>
          <div id={errorsId} className="dsl-status">
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
              <>
                <p className="dsl-status-head ok">{t('behavior.ok')}</p>
                {missingKey && <p className="dsl-status-note">{t(missingKey)}</p>}
              </>
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
