import type { Graph } from '../engine/types'
import type { Lang } from '../i18n'
import { cachePreset } from './cache'
import type { PresetShape } from './helpers'
import { loadBalancerPreset } from './load-balancer'
import { pubsubPreset } from './pubsub'
import { choreographyPreset, orchestrationPreset } from './purchase-order'
import { edgeCachePreset, reverseProxyPreset } from './reverse-proxy'
import { sessionsPresets } from './sessions'
import { queuePreset, syncPreset } from './sync-vs-queue'
import { TOPICS, type TopicId } from './topics'

export { TOPICS, TOPIC_COLORS, type TopicId } from './topics'

export interface Preset extends Omit<PresetShape, 'related'> {
  topic: TopicId
  /** Presets to compare with: the rest of its topic, then the related ones. */
  compare: string[]
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

const build = (lang: Lang): PresetShape[] => [
  loadBalancerPreset(lang),
  ...sessionsPresets(lang),
  syncPreset(lang),
  queuePreset(lang),
  pubsubPreset(lang),
  orchestrationPreset(lang),
  choreographyPreset(lang),
  reverseProxyPreset(lang),
  edgeCachePreset(lang),
  cachePreset(lang),
]

/** The presets in topic order, with their texts and node names in `lang` (fresh graphs every call). */
export function getPresets(lang: Lang): Preset[] {
  const byId = new Map(build(lang).map((p) => [p.id, p]))
  return TOPICS.flatMap((topic) =>
    topic.presets.map((id) => {
      const { related = [], ...shape } = byId.get(id)!
      const siblings = topic.presets.filter((other) => other !== id)
      return { ...shape, topic: topic.id, compare: [...siblings, ...related] }
    }),
  )
}
