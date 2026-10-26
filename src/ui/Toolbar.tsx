import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent } from 'react'
import { encodeHash } from '../persistence/hash'
import { LANGS, useLang, useT } from '../i18n'
import { printGraphDsl } from '../persistence/dsl'
import { parseAnyGraph } from '../persistence/importText'
import { getPresets } from '../presets'
import { SPEEDS, stepSpeed, useRuntime } from './runtime/runtimeStore'
import type { SimApi } from './runtime/useSimulation'
import { useEditor } from './store/editor'
import { useGraphText } from './store/graphText'
import { useLoadGraph } from './useLoadGraph'

const TOAST_MS = 2500
/** Some browsers start the download asynchronously; keep the blob URL alive a while. */
const REVOKE_URL_MS = 1000

/** Keyboard shortcuts are ignored while typing in a form control. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

/** Space activates a focused button or link natively; the play shortcut must not hijack it. */
function isActivatable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a[href], [role="button"]') !== null
}

const REPO_URL = 'https://github.com/gastonprieto/architecture-playground'

const formatSpeed = (s: number) => `${s}x`

/** A toolbar button that does not keep focus after a mouse click, so Space keeps toggling play. */
function Btn(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" onMouseDown={(e) => e.preventDefault()} {...props} />
}

/** A button that collapses to its icon on narrow screens; the label stays as its accessible name and tooltip. */
function IconBtn({ icon, label, title, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <Btn aria-label={label} title={title ?? label} {...props}>
      <span className="tb-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tb-label">{label}</span>
    </Btn>
  )
}

/** `ES | EN` switch; the active language is pressed. */
function LangToggle() {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const t = useT()
  return (
    <div className="lang-toggle" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <Btn key={l} className={l === lang ? 'active' : undefined} aria-pressed={l === lang} title={t(`lang.${l}`)} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </Btn>
      ))}
    </div>
  )
}

function useToast() {
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = useCallback((text: string) => {
    clearTimeout(timer.current)
    setToast({ text, key: Date.now() })
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { toast, show }
}

export function Toolbar({ api, mobile }: { api: SimApi; mobile: boolean }) {
  const playing = useRuntime((s) => s.playing)
  const speed = useRuntime((s) => s.speed)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const isEmpty = useEditor((s) => s.graph.nodes.length === 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast, show } = useToast()
  const { toggle, step, reset, setSpeed } = api
  const lang = useLang((s) => s.lang)
  const t = useT()
  const presets = useMemo(() => getPresets(lang), [lang])
  const reduced = useReducedMotion()

  const load = useLoadGraph(api)

  /** Remove every component (undoable) and restart the simulation. */
  const clearAll = useCallback(() => {
    useEditor.getState().replaceGraph({ nodes: [], edges: [] })
    reset()
    show(t('toolbar.cleared'))
  }, [reset, show, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        if (mobile) return
        e.preventDefault()
        if (e.shiftKey) useEditor.getState().redo()
        else useEditor.getState().undo()
        return
      }
      if (mod || e.altKey) return
      if (e.key === ' ') {
        if (e.repeat || isActivatable(e.target)) return
        e.preventDefault()
        toggle()
      } else if (e.key === '-' || e.key === '_') {
        setSpeed(stepSpeed(useRuntime.getState().speed, -1))
      } else if (e.key === '+' || e.key === '=') {
        setSpeed(stepSpeed(useRuntime.getState().speed, 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobile, toggle, setSpeed])

  const onPreset = (e: ChangeEvent<HTMLSelectElement>) => {
    // Reusing the memoized graphs is safe: the editor and the engine never mutate a graph in place.
    const preset = presets.find((p) => p.id === e.target.value)
    e.target.blur()
    if (preset) load(preset.graph)
  }

  const onExport = () => {
    const blob = new Blob([printGraphDsl(useEditor.getState().graph)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = t('toolbar.exportFilename')
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_MS)
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    if (text.trim() === '') {
      show(t('errors.empty-file'))
      return
    }
    const r = parseAnyGraph(text)
    if (!r.ok) {
      if (r.format === 'json') {
        show(t(`errors.${r.error.error}`, r.error.error === 'dangling-edge' ? { edgeId: r.error.edgeId } : undefined))
      } else {
        // Show the file in the dialog with every error; the current graph is untouched.
        useGraphText.getState().show(text, fileRef.current)
      }
      return
    }
    load(r.graph)
  }

  const onCopyLink = () => {
    const url = location.origin + location.pathname + encodeHash(useEditor.getState().graph)
    const fail = () => show(url)
    try {
      navigator.clipboard.writeText(url).then(() => show(t('toolbar.linkCopied')), fail)
    } catch {
      fail()
    }
  }

  return (
    <>
      <h1 className="app-title">Architecture Playground</h1>
      <div className="toolbar-group">
        <Btn className="primary" onClick={toggle} aria-pressed={playing} title={t('toolbar.playTitle')}>
          {playing ? t('toolbar.pause') : t('toolbar.play')}
        </Btn>
        {!mobile && (
          <Btn onClick={step} title={t('toolbar.stepTitle')}>
            {t('toolbar.step')}
          </Btn>
        )}
        <Btn onClick={reset}>{t('toolbar.reset')}</Btn>
        {!mobile && (
          <select
            className="toolbar-select speed"
            value={String(speed)}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label={t('toolbar.speedTitle')}
            title={t('toolbar.speedTitle')}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={String(s)}>
                {formatSpeed(s)}
              </option>
            ))}
          </select>
        )}
      </div>
      <select className="toolbar-select" value="" onChange={onPreset} aria-label={t('toolbar.presets')}>
        <option value="" disabled>
          {t('toolbar.presetsPlaceholder')}
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id} title={p.description}>
            {p.name}
          </option>
        ))}
      </select>
      {!mobile && (
        <div className="toolbar-group">
          <IconBtn
            icon="↶"
            label={t('toolbar.undo')}
            onClick={() => useEditor.getState().undo()}
            disabled={!canUndo}
            title={`${t('toolbar.undo')} (Ctrl/Cmd+Z)`}
          />
          <IconBtn
            icon="↷"
            label={t('toolbar.redo')}
            onClick={() => useEditor.getState().redo()}
            disabled={!canRedo}
            title={`${t('toolbar.redo')} (Ctrl/Cmd+Shift+Z)`}
          />
          <IconBtn icon="🗑" label={t('toolbar.clearAll')} className="danger" onClick={clearAll} disabled={isEmpty} />
        </div>
      )}
      <div className="toolbar-group toolbar-end">
        {!mobile && (
          <>
            <IconBtn icon="⤓" label={t('toolbar.export')} onClick={onExport} />
            <IconBtn icon="⤒" label={t('toolbar.import')} onClick={() => fileRef.current?.click()} />
            <IconBtn icon="✎" label={t('toolbar.text')} onClick={(e) => useGraphText.getState().show(printGraphDsl(useEditor.getState().graph), e.currentTarget)} />
            <input ref={fileRef} type="file" accept=".arch,.txt,.json,text/plain,application/json" hidden onChange={onImport} />
            <IconBtn icon="🔗" label={t('toolbar.copyLink')} onClick={onCopyLink} />
          </>
        )}
        <LangToggle />
        <a className="repo-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t('toolbar.repo')} title={t('toolbar.repo')}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            className="toast"
            role="status"
            initial={{ opacity: 0, x: '-50%', y: reduced ? 0 : -4 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: reduced ? 0 : -4 }}
            transition={{ duration: reduced ? 0 : 0.15, ease: 'easeOut' }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
