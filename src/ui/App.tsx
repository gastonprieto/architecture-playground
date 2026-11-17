import { Analytics } from '@vercel/analytics/react'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useRef } from 'react'
import { useLang, useT } from '../i18n'
import { clearLocationHash, initialGraph } from '../persistence/initial'
import { saveLocal } from '../persistence/storage'
import { Canvas } from './canvas/Canvas'
import { BehaviorEditorDialog } from './BehaviorEditor'
import { GraphTextDialog } from './GraphTextDialog'
import { prepareGraph } from './graphEntry'
import { InfoDialog } from './InfoDialog'
import { NewDiagramDialog } from './NewDiagramDialog'
import { Inspector } from './Inspector'
import { MetricsBar } from './MetricsBar'
import { Palette } from './Palette'
import { SimContext, useSimulation } from './runtime/useSimulation'
import { useEditor } from './store/editor'
import './theme.css'
import './playground.css'
import { useTheme } from './store/theme'
import { Toolbar } from './Toolbar'
import { useBehaviorEditor } from './store/behaviorEditor'
import { useGraphText } from './store/graphText'
import { useInfoPanel } from './store/infoPanel'
import { useNewDiagram } from './store/newDiagram'
import { useScenario } from './store/scenario'
import { ScenarioGuide } from './ScenarioGuide'
import { ScenarioPicker } from './ScenarioPicker'
import { useIsland } from './useIsland'
import { useIsMobile } from './useIsMobile'
import { stripHash, track } from './analytics'

const SAVE_DEBOUNCE_MS = 500

/** Loads the startup graph once, then persists every graph change to localStorage (debounced). */
function usePersistence() {
  const loaded = useRef(false)
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true
      // A shared link is loaded once; after that the local copy is the source of truth.
      useEditor.getState().loadGraph(
        prepareGraph(
          initialGraph(
            useLang.getState().lang,
            undefined,
            () => {
              clearLocationHash()
              track({ name: 'shared_link_opened' })
              // A shared graph is the sender's own: no scenario guide.
              useScenario.getState().setCurrent(null)
            },
            (id) => useScenario.getState().setCurrent(id),
          ),
        ),
      )
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
  const textOpen = useGraphText((s) => s.text !== null)
  const pickerOpen = useScenario((s) => s.pickerOpen)
  const newOpen = useNewDiagram((s) => s.open)
  const theme = useTheme((s) => s.theme)
  const guideShown = useScenario((s) => s.currentId !== null && s.guideOpen)
  const { attach: attachInspector, style: inspectorStyle, className: inspectorClass, grip: inspectorGrip } = useIsland('inspector', !mobile)
  return (
    <ReactFlowProvider>
      <SimContext.Provider value={api}>
        {/* Inert behind a dialog: no clicks, focus or keys reach the editor while it is open. */}
        <div className={`app${mobile ? ' mobile' : ''}`} inert={infoOpen || behaviorOpen || textOpen || pickerOpen || newOpen}>
          <header className="toolbar">
            <Toolbar api={api} mobile={mobile} />
          </header>
          {!mobile && <Palette />}
          <main className="canvas">
            <Canvas readOnly={mobile} guide={guideShown} floating colorMode={theme} />
            <ScenarioGuide api={api} />
          </main>
          {!mobile && (
            <aside ref={attachInspector} style={inspectorStyle} className={`inspector${inspectorClass}`} aria-label={t('inspector.label')}>
              {inspectorGrip}
              <Inspector runAction={api.runAction} />
            </aside>
          )}
          <footer className="metrics">
            <MetricsBar />
          </footer>
        </div>
        <InfoDialog />
        <BehaviorEditorDialog />
        <GraphTextDialog api={api} />
        <NewDiagramDialog />
        {pickerOpen && <ScenarioPicker api={api} />}
        <Analytics beforeSend={stripHash} />
      </SimContext.Provider>
    </ReactFlowProvider>
  )
}
