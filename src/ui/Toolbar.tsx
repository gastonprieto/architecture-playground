import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent } from 'react'
import type { Graph } from '../engine/types'
import { encodeHash } from '../persistence/hash'
import { parseGraph, serializeGraph } from '../persistence/serialize'
import { presets } from '../presets'
import { cycleSpeed, stepSpeed, useRuntime } from './runtime/runtimeStore'
import type { SimApi } from './runtime/useSimulation'
import { useEditor } from './store/editor'

const TOAST_MS = 2500
const FIT_VIEW_OPTIONS = { padding: 0.15 }
const EXPORT_FILENAME = 'arquitectura.json'
/** Some browsers start the download asynchronously; keep the blob URL alive a while. */
const REVOKE_URL_MS = 1000

/** Keyboard shortcuts are ignored while typing in a form control. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

const formatSpeed = (s: number) => `${s}x`

/** A toolbar button that does not keep focus after a mouse click, so Space keeps toggling play. */
function Btn(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" onMouseDown={(e) => e.preventDefault()} {...props} />
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
  const { fitView } = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast, show } = useToast()
  const { toggle, step, reset, setSpeed } = api

  /** Replace the graph (undoable), restart the simulation and frame the new graph. */
  const load = useCallback(
    (g: Graph) => {
      useEditor.getState().replaceGraph(g)
      reset()
      // React Flow queues the fit until the new nodes are measured.
      void fitView(FIT_VIEW_OPTIONS)
    },
    [reset, fitView],
  )

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
    const preset = presets.find((p) => p.id === e.target.value)
    e.target.blur()
    if (preset) load(preset.graph)
  }

  const onExport = () => {
    const blob = new Blob([serializeGraph(useEditor.getState().graph)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = EXPORT_FILENAME
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_MS)
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const r = parseGraph(await file.text())
    if (!r.ok) {
      show(r.error)
      return
    }
    load(r.graph)
  }

  const onCopyLink = () => {
    const url = location.origin + location.pathname + encodeHash(useEditor.getState().graph)
    const fail = () => show(url)
    try {
      navigator.clipboard.writeText(url).then(() => show('Link copiado'), fail)
    } catch {
      fail()
    }
  }

  return (
    <>
      <h1 className="app-title">Architecture Playground</h1>
      <div className="toolbar-group">
        <Btn className="primary" onClick={toggle} aria-pressed={playing} title="Espacio">
          {playing ? '⏸ Pausa' : '▶ Play'}
        </Btn>
        {!mobile && (
          <Btn onClick={step} title="Avanzar 100 ms">
            Paso
          </Btn>
        )}
        <Btn onClick={reset}>Reset</Btn>
        {!mobile && (
          <Btn className="speed" onClick={() => setSpeed(cycleSpeed(speed))} title="Velocidad (teclas - y +)">
            {formatSpeed(speed)}
          </Btn>
        )}
      </div>
      <select className="toolbar-select" value="" onChange={onPreset} aria-label="Presets">
        <option value="" disabled>
          Presets…
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id} title={p.description}>
            {p.name}
          </option>
        ))}
      </select>
      {!mobile && (
        <>
          <div className="toolbar-group">
            <Btn onClick={() => useEditor.getState().undo()} disabled={!canUndo} title="Ctrl/Cmd+Z">
              Deshacer
            </Btn>
            <Btn onClick={() => useEditor.getState().redo()} disabled={!canRedo} title="Ctrl/Cmd+Shift+Z">
              Rehacer
            </Btn>
          </div>
          <div className="toolbar-group toolbar-end">
            <Btn onClick={onExport}>Exportar</Btn>
            <Btn onClick={() => fileRef.current?.click()}>Importar</Btn>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
            <Btn onClick={onCopyLink}>Copiar link</Btn>
          </div>
        </>
      )}
      {toast && (
        <div key={toast.key} className="toast" role="status">
          {toast.text}
        </div>
      )}
    </>
  )
}
