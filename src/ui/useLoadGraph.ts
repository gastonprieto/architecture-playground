import { useReactFlow, type FitViewOptions } from '@xyflow/react'
import { useCallback } from 'react'
import type { Graph } from '../engine/types'
import { FIT_VIEW_OPTIONS } from './fitView'
import { prepareGraph } from './graphEntry'
import type { SimApi } from './runtime/useSimulation'
import { useEditor } from './store/editor'

/** Replace the graph (undoable), restart the simulation and frame the new graph (with `fit`, if given). */
export function useLoadGraph(api: SimApi): (g: Graph, fit?: FitViewOptions) => void {
  const { fitView } = useReactFlow()
  const { reset } = api
  return useCallback(
    (g: Graph, fit: FitViewOptions = FIT_VIEW_OPTIONS) => {
      useEditor.getState().replaceGraph(prepareGraph(g))
      reset()
      // React Flow queues the fit until the new nodes are measured.
      void fitView(fit)
    },
    [reset, fitView],
  )
}
