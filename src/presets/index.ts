import type { Graph } from '../engine/types'
import type { Lang } from '../i18n'
import { loadBalancerPreset } from './load-balancer'
import { pubsubPreset } from './pubsub'
import { purchaseOrderPreset } from './purchase-order'
import { reverseProxyPreset } from './reverse-proxy'
import { syncVsQueuePreset } from './sync-vs-queue'

export interface Preset {
  id: string
  name: string
  description: string
  /** Rate (req/s) each client is tuned for; preset clients start at 0 so the user starts the traffic. */
  demoRates: Record<string, number>
  graph: Graph
}

/** The preset's graph with every client at its demo rate. */
export function withDemoTraffic(preset: Preset): Graph {
  return {
    ...preset.graph,
    nodes: preset.graph.nodes.map((n) =>
      n.id in preset.demoRates ? { ...n, config: { ...n.config, rate: preset.demoRates[n.id] } } : n,
    ),
  }
}

const builders = [loadBalancerPreset, syncVsQueuePreset, pubsubPreset, reverseProxyPreset, purchaseOrderPreset]

/** The presets with their names, descriptions and node names in `lang` (fresh graphs every call). */
export const getPresets = (lang: Lang): Preset[] => builders.map((build) => build(lang))
