import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useRef } from 'react'
import { initialGraph } from '../persistence/initial'
import { saveLocal } from '../persistence/storage'
import { Canvas } from './canvas/Canvas'
import { Palette } from './Palette'
import { useEditor } from './store/editor'
import './theme.css'
import { useIsMobile } from './useIsMobile'

const SAVE_DEBOUNCE_MS = 500

/** Loads the startup graph once, then persists every graph change to localStorage (debounced). */
function usePersistence() {
  const loaded = useRef(false)
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true
      useEditor.getState().loadGraph(initialGraph())
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.graph === prev.graph) return
      clearTimeout(timer)
      timer = setTimeout(() => saveLocal(useEditor.getState().graph), SAVE_DEBOUNCE_MS)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [])
}

export default function App() {
  usePersistence()
  const mobile = useIsMobile()
  return (
    <ReactFlowProvider>
      <div className={`app${mobile ? ' mobile' : ''}`}>
        {/* Toolbar slot: Task 18 adds play/pause, step, speed, reset, presets, export/import, link. */}
        <header className="toolbar">
          <h1 className="app-title">Architecture Playground</h1>
        </header>
        {!mobile && <Palette />}
        <main className="canvas">
          <Canvas readOnly={mobile} />
        </main>
        {/* Inspector slot: Task 17 renders <Inspector/> inside this aside. */}
        {!mobile && <aside className="inspector" aria-label="Inspector" />}
        {/* MetricsBar slot: Task 18 renders throughput, p50/p95 and error rate here. */}
        <footer className="metrics" />
      </div>
    </ReactFlowProvider>
  )
}
