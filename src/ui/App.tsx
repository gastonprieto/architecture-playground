import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useRef } from 'react'
import { useLang, useT } from '../i18n'
import { clearLocationHash, initialGraph } from '../persistence/initial'
import { saveLocal } from '../persistence/storage'
import { Canvas } from './canvas/Canvas'
import { BehaviorEditorDialog } from './BehaviorEditor'
import { prepareGraph } from './graphEntry'
import { InfoDialog } from './InfoDialog'
import { Inspector } from './Inspector'
import { MetricsBar } from './MetricsBar'
import { Palette } from './Palette'
import { SimContext, useSimulation } from './runtime/useSimulation'
import { useEditor } from './store/editor'
import './theme.css'
import { Toolbar } from './Toolbar'
import { useBehaviorEditor } from './store/behaviorEditor'
import { useInfoPanel } from './store/infoPanel'
import { useIsMobile } from './useIsMobile'

const SAVE_DEBOUNCE_MS = 500

/** Loads the startup graph once, then persists every graph change to localStorage (debounced). */
function usePersistence() {
  const loaded = useRef(false)
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true
      // A shared link is loaded once; after that the local copy is the source of truth.
      useEditor.getState().loadGraph(prepareGraph(initialGraph(useLang.getState().lang, undefined, clearLocationHash)))
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
  const api = useSimulation()
  const t = useT()
  const infoOpen = useInfoPanel((s) => s.type !== null)
  const behaviorOpen = useBehaviorEditor((s) => s.nodeId !== null)
  return (
    <ReactFlowProvider>
      <SimContext.Provider value={api}>
        {/* Inert behind a dialog: no clicks, focus or keys reach the editor while it is open. */}
        <div className={`app${mobile ? ' mobile' : ''}`} inert={infoOpen || behaviorOpen}>
          <header className="toolbar">
            <Toolbar api={api} mobile={mobile} />
          </header>
          {!mobile && <Palette />}
          <main className="canvas">
            <Canvas readOnly={mobile} />
          </main>
          {!mobile && (
            <aside className="inspector" aria-label={t('inspector.label')}>
              <Inspector runAction={api.runAction} />
            </aside>
          )}
          <footer className="metrics">
            <MetricsBar />
          </footer>
        </div>
        <InfoDialog />
        <BehaviorEditorDialog />
      </SimContext.Provider>
    </ReactFlowProvider>
  )
}
