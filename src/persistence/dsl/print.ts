import { defaultRegistry } from '../../components'
import { defaultConfig, type ComponentDef } from '../../engine/registry'
import type { EdgeRule, Graph, GraphEdge, GraphNode, NodeId } from '../../engine/types'
import { COL, ROW } from '../grid'
import { slugify } from './parse'
import { formatFieldValue, quoteIfNeeded } from './values'

/**
 * Graph → canonical DSL text (docs/graph-dsl-spec.md §9): the header, one declaration per node in
 * graph order with `at` and only its non-default config, then one edge line per source.
 * `parseGraphDsl(printGraphDsl(g))` gives `g` back up to ids, position rounding and unknown config.
 */
export function printGraphDsl(graph: Graph): string {
  const refs = nodeRefs(graph.nodes)
  const lines: string[] = ['@architecture v1']
  const blank = () => {
    if (lines[lines.length - 1] !== '') lines.push('')
  }
  blank()
  for (const node of graph.nodes) {
    const def = defaultRegistry.get(node.type)
    const config = def ? configLines(def, node.config) : []
    if (config.length > 0) blank()
    const { name, alias } = refs.get(node.id)!
    const x = round(node.position.x / COL)
    const y = round(node.position.y / ROW)
    lines.push(`${node.type} ${quoteName(name)}${alias === undefined ? '' : ` as ${alias}`} at ${x},${y}`, ...config)
    if (config.length > 0) blank()
  }

  const bySource = new Map<NodeId, GraphEdge[]>()
  for (const edge of graph.edges) {
    if (!refs.has(edge.source) || !refs.has(edge.target)) continue
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge])
  }
  if (bySource.size > 0) blank()
  const ref = (id: NodeId) => {
    const { name, alias } = refs.get(id)!
    return alias ?? quoteName(name)
  }
  for (const [source, edges] of bySource) {
    lines.push(`${ref(source)} --> ${edges.map((e) => ref(e.target) + attributes(e)).join(', ')}`)
  }
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

const round = (n: number) => String(Number(n.toFixed(2)) || 0)

const ALIAS = /^[\p{L}\p{N}_-]+$/u

/**
 * Each node's name and, when the name is shared, an alias: its id when that is a valid alias, else
 * the id's slug. Aliases never repeat and never equal a node name, so every ref resolves to one node.
 */
function nodeRefs(nodes: GraphNode[]): Map<NodeId, { name: string; alias?: string }> {
  const nameOf = (n: GraphNode) => String(n.config.name ?? n.id)
  const count = new Map<string, number>()
  for (const n of nodes) count.set(nameOf(n), (count.get(nameOf(n)) ?? 0) + 1)
  const taken = new Set(count.keys())
  const refs = new Map<NodeId, { name: string; alias?: string }>()
  for (const n of nodes) {
    const name = nameOf(n)
    if (count.get(name)! < 2) {
      refs.set(n.id, { name })
      continue
    }
    const base = ALIAS.test(n.id) ? n.id : slugify(n.id)
    let alias = base
    for (let k = 2; taken.has(alias); k++) alias = `${base}-${k}`
    taken.add(alias)
    refs.set(n.id, { name, alias })
  }
  return refs
}

const NAME_UNSAFE = /[,"[\]#]|-->|^\s|\s$|\s(as|at)\s|\s(as|at)$/

const quoteName = (name: string) => quoteIfNeeded(name, NAME_UNSAFE)

/** `  key: value` for every registry field (but `name`) that differs from its default. */
function configLines(def: ComponentDef, config: Record<string, unknown>): string[] {
  const defaults = defaultConfig(def)
  const lines: string[] = []
  for (const [key, field] of Object.entries(def.config)) {
    if (key === 'name' || !Object.hasOwn(config, key) || deepEqual(config[key], defaults[key])) continue
    if (field.type === 'behavior') {
      const text = String(config[key]).replace(/\n$/, '')
      lines.push('  behavior:', ...text.split('\n').map((l) => (l === '' ? '' : `    ${l}`)))
    } else {
      lines.push(`  ${key}: ${formatFieldValue(field, config[key])}`.trimEnd())
    }
  }
  return lines
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as never)[k], (b as never)[k]))
}

const ATTR_UNSAFE = /[\s,\]"]/

/** ` [rule weight]` in short form where the parser would read it back the same, long form otherwise. */
function attributes(edge: GraphEdge): string {
  const parts: string[] = []
  if (edge.rule) parts.push(ruleText(edge.rule))
  if (edge.weight !== undefined) parts.push(`x${edge.weight}`)
  return parts.length > 0 ? ` [${parts.join(' ')}]` : ''
}

function ruleText(rule: EdgeRule): string {
  const value = quoteIfNeeded(rule.value, ATTR_UNSAFE)
  if (rule.kind === 'pathPrefix') return rule.value.startsWith('/') && value === rule.value ? value : `path ${value}`
  const short = !rule.value.startsWith('/') && !/^x[\d.]/.test(rule.value) && !['path', 'event', 'weight'].includes(rule.value)
  return short ? value : `event ${value}`
}
