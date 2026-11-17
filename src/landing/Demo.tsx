import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useLang, useT } from '../i18n'
import { encodeHash } from '../persistence/hash'
import { getPresets, TOPICS } from '../presets'
import { Canvas } from '../ui/canvas/Canvas'
import { BehaviorEditorDialog } from '../ui/BehaviorEditor'
import { prepareGraph } from '../ui/graphEntry'
import { rich } from '../ui/richText'
import { InfoDialog } from '../ui/InfoDialog'
import { Inspector } from '../ui/Inspector'
import { MetricsBar } from '../ui/MetricsBar'
import { SPEEDS, useRuntime } from '../ui/runtime/runtimeStore'
import { SimContext, useSimulation } from '../ui/runtime/useSimulation'
import { useEditor } from '../ui/store/editor'
import '../ui/theme.css'
import '../ui/playground.css'
import { useLoadGraph } from '../ui/useLoadGraph'
import { useIsMobile } from '../ui/useIsMobile'
import { COPY } from './copy'
import { PLAY_PATH } from './legacyLink'
import { Logo } from '../ui/Logo'

export const DEMO_PRESET = 'load-balancer'

/** The demo's graph is loaded before the simulation is created, so it starts with the preset. */
function loadInitialPreset() {
  const preset = getPresets(useLang.getState().lang).find((p) => p.id === DEMO_PRESET)!
  useEditor.getState().loadGraph(prepareGraph(preset.graph))
}

/**
 * The real playground (canvas, packets, inspector, metrics and engine) with a preset loaded and a
 * reduced toolbar. No palette: the canvas gets the room. Nothing is saved: the landing never touches
 * the playground's local copy.
 */
export function Demo() {
  const [ready] = useState(() => {
    loadInitialPreset()
    return true
  })
  return ready ? (
    <ReactFlowProvider>
      <DemoInner />
    </ReactFlowProvider>
  ) : null
}

function DemoInner() {
  const api = useSimulation()
  const load = useLoadGraph(api)
  const mobile = useIsMobile()
  const reduced = useReducedMotion()
  const t = useT()
  const lang = useLang((s) => s.lang)
  const c = COPY[lang].demo
  const playing = useRuntime((s) => s.playing)
  const speed = useRuntime((s) => s.speed)
  const presets = useMemo(() => getPresets(lang), [lang])
  const [presetId, setPresetId] = useState(DEMO_PRESET)
  const { play, pause, toggle, reset, setSpeed } = api

  // The landing shows the system moving; with reduced motion it waits for Play.
  useEffect(() => {
    if (!reduced) play()
    return pause
  }, [reduced, play, pause])

  const onPreset = (e: ChangeEvent<HTMLSelectElement>) => {
    const preset = presets.find((p) => p.id === e.target.value)
    if (!preset) return
    setPresetId(preset.id)
    load(preset.graph)
    if (!reduced) play()
  }

  const openInPlayground = () => {
    window.location.href = PLAY_PATH + encodeHash(useEditor.getState().graph)
  }

  const preset = presets.find((p) => p.id === presetId)

  return (
    <SimContext.Provider value={api}>
      <div className={`demo${mobile ? ' mobile' : ''}`} role="group" aria-label={c.label}>
        <header className="toolbar">
          <span className="app-title">
            <Logo />
            Nodarium
          </span>
          <div className="toolbar-group">
            <select className="toolbar-select" value={presetId} onChange={onPreset} aria-label={c.preset}>
              {TOPICS.map((topic) => (
                <optgroup key={topic.id} label={t(`topics.${topic.id}.name`)}>
                  {presets
                    .filter((p) => p.topic === topic.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="toolbar-sep" aria-hidden="true" />
          <div className="toolbar-group">
            <button type="button" className="primary" onClick={toggle} aria-pressed={playing}>
              {playing ? t('toolbar.pause') : t('toolbar.play')}
            </button>
            <button type="button" onClick={reset}>
              {t('toolbar.reset')}
            </button>
            <select
              className="toolbar-select speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label={c.speed}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar-group toolbar-end">
            <button type="button" onClick={openInPlayground} title={c.openHereTitle}>
              {c.openHere}
            </button>
          </div>
        </header>
        <main className="canvas">
          <Canvas readOnly={mobile} />
        </main>
        {!mobile && (
          <aside className="inspector" aria-label={t('inspector.label')}>
            <Inspector
              runAction={api.runAction}
              empty={
                preset && (
                  <div className="demo-explain">
                    <h2>{preset.name}</h2>
                    <p>{preset.description}</p>
                    <ol className="scenario-steps">
                      {preset.steps.map((s, i) => (
                        <li key={i}>{rich(s)}</li>
                      ))}
                    </ol>
                  </div>
                )
              }
            />
          </aside>
        )}
        <footer className="metrics">
          <MetricsBar />
        </footer>
      </div>
      {mobile && preset && <p className="demo-description">{preset.description}</p>}
      <InfoDialog />
      <BehaviorEditorDialog />
    </SimContext.Provider>
  )
}
