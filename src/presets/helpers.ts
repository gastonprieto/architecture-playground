import { defaultRegistry } from '../components'
import { defaultConfig } from '../engine/registry'
import type { EdgeRule, GraphEdge, GraphNode } from '../engine/types'
import { translate, type Lang, type Params } from '../i18n'

/** Horizontal distance between columns, and vertical distance between rows, in canvas px. */
export const COL = 250
export const ROW = 120

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

export interface PresetShape {
  id: string
  name: string
  description: string
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
}

/** Texts of one preset in `lang`: `text('nodes.web')` reads `presets.<id>.nodes.web`. */
export function presetText(lang: Lang, id: string) {
  const text = (key: string, params?: Params) => translate(lang, `presets.${id}.${key}`, params)
  return { text, name: text('name'), description: text('description') }
}
