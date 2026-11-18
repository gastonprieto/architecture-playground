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
import { useNewDiagram } from './store/newDiagram'
import { useScenario } from './store/scenario'
import { useLoadGraph } from './useLoadGraph'
import { fitViewOptions } from './fitView'
import { useTheme } from './store/theme'
import { track } from './analytics'
import { Logo } from './Logo'
import { ToolbarMenu } from './ToolbarMenu'
import { Icon, type IconName } from './Icon'

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

const REPO_URL = 'https://github.com/gastonprieto/nodarium'
const GITHUB_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'

const formatSpeed = (s: number) => `${s}x`

/** A toolbar button that does not keep focus after a mouse click, so Space keeps toggling play. */
function Btn(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" onMouseDown={(e) => e.preventDefault()} {...props} />
}

/** An icon-only toolbar button; the label is its accessible name and tooltip. */
function IconBtn({ icon, label, title, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <Btn className="icon-btn" aria-label={label} title={title ?? label} {...props}>
      <Icon name={icon} />
    </Btn>
  )
}

/** A row of the `⋯` menu: icon + label, closes the menu after running. */
function MenuItem({ icon, label, onClick, close, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  icon: IconName
  label: string
  onClick: () => void
  close: () => void
}) {
  return (
    <Btn
      className="toolbar-menu-item"
      onClick={() => {
        onClick()
        close()
      }}
      {...props}
    >
      <Icon name={icon} className="toolbar-menu-icon" />
      {label}
    </Btn>
  )
}

/** `Claro | Oscuro` switch inside the menu; the active theme is pressed. */
function ThemeSwitch() {
  const theme = useTheme((s) => s.theme)
  const toggle = useTheme((s) => s.toggle)
  const t = useT()
  return (
    <div className="toolbar-menu-row">
      <span>{t('toolbar.theme')}</span>
      <div className="lang-toggle" role="group" aria-label={t('toolbar.theme')}>
        {(['light', 'dark'] as const).map((th) => (
          <Btn key={th} className={th === theme ? 'active' : undefined} aria-pressed={th === theme} onClick={() => {
              if (th === theme) return
              track({ name: 'theme_changed', props: { theme: th } })
              toggle()
            }}>
            {t(`toolbar.${th}`)}
          </Btn>
        ))}
      </div>
    </div>
  )
}

/** `ES | EN` switch; the active language is pressed. */
function LangSwitch() {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const t = useT()
  return (
    <div className="toolbar-menu-row">
      <span>{t('lang.label')}</span>
      <div className="lang-toggle" role="group" aria-label={t('lang.label')}>
        {LANGS.map((l) => (
          <Btn key={l} className={l === lang ? 'active' : undefined} aria-pressed={l === lang} title={t(`lang.${l}`)} onClick={() => {
              if (l !== lang) track({ name: 'lang_changed', props: { lang: l } })
              setLang(l)
            }}>
            {l.toUpperCase()}
          </Btn>
        ))}
      </div>
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
  const currentId = useScenario((st) => st.currentId)
  const guideOpen = useScenario((st) => st.guideOpen)
  const scenario = presets.find((p) => p.id === currentId)
  const reduced = useReducedMotion()

  const fit = useMemo(() => fitViewOptions(false, mobile, true), [mobile])
  const load = useLoadGraph(api, fit)

  /** Start an empty diagram: remove every component (undoable), leave the scenario and restart the simulation. */
  const newDiagram = useCallback(() => {
    useEditor.getState().replaceGraph({ nodes: [], edges: [] })
    useScenario.getState().setCurrent(null)
    reset()
    track({ name: 'graph_cleared' })
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
    track({ name: 'graph_exported' })
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
    track({ name: 'graph_imported', props: { format: file.name.split('.').pop()?.toLowerCase() ?? 'unknown' } })
    load(r.graph)
    useScenario.getState().setCurrent(null)
  }

  const onCopyLink = () => {
    const url = location.origin + location.pathname + encodeHash(useEditor.getState().graph)
    track({ name: 'link_copied' })
    const fail = () => show(url)
    try {
      navigator.clipboard.writeText(url).then(() => show(t('toolbar.linkCopied')), fail)
    } catch {
      fail()
    }
  }

  return (
    <>
      <h1 className="app-title">
        <Logo />
        Nodarium
      </h1>
      <div className="toolbar-group">
        {!mobile && (
          <Btn
            aria-haspopup="dialog"
            title={t('toolbar.newTitle')}
            disabled={isEmpty}
            onClick={(e) => useNewDiagram.getState().ask(e.currentTarget, newDiagram)}
          >
            <Icon name="new" />
            {t('toolbar.new')}
          </Btn>
        )}
        <Btn
          className="scenario-btn"
          aria-haspopup="dialog"
          aria-label={scenario ? `${t('scenarios.button')}: ${scenario.name}` : t('scenarios.button')}
          title={scenario ? `${t('scenarios.title')} · ${scenario.name}` : t('scenarios.title')}
          onClick={(e) => useScenario.getState().openPicker(e.currentTarget)}
        >
          <Icon name="scenarios" />
          {t('scenarios.button')}
          <Icon name="caret" size={14} className="caret" />
        </Btn>
        {scenario && !guideOpen && (
          <IconBtn icon="guide" label={t('scenarios.guide')} onClick={() => useScenario.getState().setGuideOpen(true)} />
        )}
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        <Btn className="primary" onClick={toggle} aria-pressed={playing} title={t('toolbar.playTitle')}>
          <Icon name={playing ? 'pause' : 'play'} size={14} />
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
            onChange={(e) => {
              const s = Number(e.target.value)
              track({ name: 'speed_changed', props: { speed: s } })
              setSpeed(s)
            }}
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
      {!mobile && (
        <>
          <div className="toolbar-sep" aria-hidden="true" />
          <div className="toolbar-group">
            <IconBtn
              icon="undo"
              label={t('toolbar.undo')}
              onClick={() => useEditor.getState().undo()}
              disabled={!canUndo}
              title={`${t('toolbar.undo')} (Ctrl/Cmd+Z)`}
            />
            <IconBtn
              icon="redo"
              label={t('toolbar.redo')}
              onClick={() => useEditor.getState().redo()}
              disabled={!canRedo}
              title={`${t('toolbar.redo')} (Ctrl/Cmd+Shift+Z)`}
            />
          </div>
        </>
      )}
      <div className="toolbar-group toolbar-end">
        <input ref={fileRef} type="file" accept=".arch,.txt,.json,text/plain,application/json" hidden onChange={onImport} />
        <ToolbarMenu label={t('toolbar.more')}>
          {(close, trigger) => (
            <>
              {!mobile && (
                <>
                  <MenuItem icon="link" label={t('toolbar.copyLink')} onClick={onCopyLink} close={close} />
                  <MenuItem icon="export" label={t('toolbar.export')} onClick={onExport} close={close} />
                  <MenuItem icon="import" label={t('toolbar.import')} onClick={() => fileRef.current?.click()} close={close} />
                  <MenuItem
                    icon="edit"
                    label={t('toolbar.text')}
                    onClick={() => {
                      track({ name: 'text_editor_opened' })
                      useGraphText.getState().show(printGraphDsl(useEditor.getState().graph), trigger)
                    }}
                    close={close}
                  />
                  <hr />
                </>
              )}
              <ThemeSwitch />
              <LangSwitch />
              <hr />
              <a className="toolbar-menu-item" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
                <svg className="toolbar-menu-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d={GITHUB_PATH} />
                </svg>
                {t('toolbar.repo')}
              </a>
            </>
          )}
        </ToolbarMenu>
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
