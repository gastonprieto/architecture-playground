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
  graph: Graph
}

const builders = [loadBalancerPreset, syncVsQueuePreset, pubsubPreset, reverseProxyPreset, purchaseOrderPreset]

/** The presets with their names, descriptions and node names in `lang` (fresh graphs every call). */
export const getPresets = (lang: Lang): Preset[] => builders.map((build) => build(lang))
