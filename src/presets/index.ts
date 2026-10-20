import type { Graph } from '../engine/types'
import { loadBalancerPreset } from './load-balancer'
import { pubsubPreset } from './pubsub'
import { reverseProxyPreset } from './reverse-proxy'
import { syncVsQueuePreset } from './sync-vs-queue'

export interface Preset {
  id: string
  name: string
  description: string
  graph: Graph
}

export const presets: Preset[] = [loadBalancerPreset, syncVsQueuePreset, pubsubPreset, reverseProxyPreset]
