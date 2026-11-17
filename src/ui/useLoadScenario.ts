import { useCallback } from 'react'
import { useLang } from '../i18n'
import { getPresets } from '../presets'
import type { SimApi } from './runtime/useSimulation'
import { useScenario } from './store/scenario'
import { fitViewOptions } from './fitView'
import { useIsMobile } from './useIsMobile'
import { useLoadGraph } from './useLoadGraph'
import { track } from './analytics'

/** Loads a preset by id, paused like the app, shows its guide and closes the picker. */
export function useLoadScenario(api: SimApi): (id: string) => void {
  const load = useLoadGraph(api)
  const { pause } = api
  const mobile = useIsMobile()
  return useCallback(
    (id: string) => {
      const preset = getPresets(useLang.getState().lang).find((p) => p.id === id)
      if (!preset) return
      pause()
      track({ name: 'preset_selected', props: { preset: preset.id } })
      // The guide opens with it: frame the graph beside it.
      load(preset.graph, fitViewOptions(true, mobile, true))
      const scenario = useScenario.getState()
      scenario.setCurrent(preset.id)
      scenario.setGuideOpen(true)
      scenario.closePicker()
    },
    [load, pause, mobile],
  )
}
