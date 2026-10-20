import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useRef } from 'react'
import { initialGraph } from '../persistence/initial'
import { saveLocal } from '../persistence/storage'
import { Canvas } from './canvas/Canvas'
import { Inspector } from './Inspector'
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
    const flush = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
      saveLocal(useEditor.getState().graph)
    }
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.graph === prev.graph) return
      clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
    })
    // A pending save must not be lost when the tab closes or the app unmounts.
    window.addEventListener('pagehide', flush)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      flush()
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
        {/* Task 18 passes the simulation's runAction to <Inspector/>. */}
        {!mobile && (
          <aside className="inspector" aria-label="Inspector">
            <Inspector />
          </aside>
        )}
        {/* MetricsBar slot: Task 18 renders throughput, p50/p95 and error rate here. */}
        <footer className="metrics" />
      </div>
    </ReactFlowProvider>
  )
}
