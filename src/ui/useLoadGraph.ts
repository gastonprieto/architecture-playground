import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import type { Graph } from '../engine/types'
import { prepareGraph } from './graphEntry'
import type { SimApi } from './runtime/useSimulation'
import { useEditor } from './store/editor'

const FIT_VIEW_OPTIONS = { padding: 0.15 }

/** Replace the graph (undoable), restart the simulation and frame the new graph. */
export function useLoadGraph(api: SimApi): (g: Graph) => void {
  const { fitView } = useReactFlow()
  const { reset } = api
  return useCallback(
    (g: Graph) => {
      useEditor.getState().replaceGraph(prepareGraph(g))
      reset()
      // React Flow queues the fit until the new nodes are measured.
      void fitView(FIT_VIEW_OPTIONS)
    },
    [reset, fitView],
  )
}
