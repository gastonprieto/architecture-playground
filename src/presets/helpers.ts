import { defaultRegistry } from '../components'
import { defaultConfig } from '../engine/registry'
import type { EdgeRule, GraphEdge, GraphNode } from '../engine/types'
import { lookupList, translate, type Lang, type Params } from '../i18n'

import { COL } from '../persistence/grid'

export { COL, ROW } from '../persistence/grid'

/** Rate (req/s) every preset client starts at: a trickle that shows the flow without loading the system. */
export const START_RATE = 1

/** A node whose config starts from the component defaults, so presets stay valid when defaults change. */
export function node(
  id: string,
  type: string,
  col: number,
  y: number,
  name: string,
  overrides: Record<string, unknown> = {},
): GraphNode {
  const def = defaultRegistry.get(type)
  if (!def) throw new Error(`Unknown component type: ${type}`)
  return { id, type, position: { x: col * COL, y }, config: { ...defaultConfig(def), name, ...overrides } }
}

export function edge(source: string, target: string, rule?: EdgeRule): GraphEdge {
  return rule ? { id: `${source}-${target}`, source, target, rule } : { id: `${source}-${target}`, source, target }
}

/** A DSL target: names with spaces are quoted. */
export const ref = (name: string) => (/\s/.test(name) ? `"${name}"` : name)

/** The texts a preset shows in the scenario picker and the "How it works" guide. */
export interface PresetGuide {
  name: string
  /** One or two sentences: what you will find. */
  description: string
  /** What the architecture does, in order. */
  steps: string[]
  /** Experiments to run on it. */
  tryThis: string[]
}

export interface PresetShape extends PresetGuide {
  id: string
  /** Rate (req/s) each client is tuned for; preset clients start at `START_RATE` and the user turns them up. */
  demoRates: Record<string, number>
  /** Presets of other topics worth comparing with (the same topic's presets are always offered). */
  related?: string[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
}

/**
 * Texts of one preset in `lang`: the guide reads `presets.<id>.{name,description,steps,try}`, and
 * `text('nodes.web')` reads `presets.<group>.nodes.web` (`group` defaults to `id`, so presets cut from
 * the same scenario can share their node names).
 */
export function presetText(lang: Lang, id: string, group: string = id) {
  const text = (key: string, params?: Params) => translate(lang, `presets.${group}.${key}`, params)
  const guide: PresetGuide = {
    name: translate(lang, `presets.${id}.name`),
    description: translate(lang, `presets.${id}.description`),
    steps: lookupList(lang, `presets.${id}.steps`) ?? [],
    tryThis: lookupList(lang, `presets.${id}.try`) ?? [],
  }
  return { text, guide }
}
