import { defaultConfig, type ComponentDef } from '../../engine/registry'
import type { Graph, NodeId } from '../../engine/types'
import type { BehaviorOutput, DslError } from './ast'
import { compileBehavior } from './compile'

/*
 * How a node's connections look to the DSL, shared by the engine (from ctx.outputs) and the UI (from
 * the editor graph), so both validate a behavior against exactly the same outputs.
 */

export interface BehaviorTarget extends BehaviorOutput {
  target: NodeId
}

/** One output per target node (a node wired twice counts once), named by its trimmed config name. */
export function behaviorTargets(links: readonly { target: NodeId; targetType: string }[], nameOf: (id: NodeId) => unknown): BehaviorTarget[] {
  const seen = new Set<NodeId>()
  const list: BehaviorTarget[] = []
  for (const { target, targetType } of links) {
    if (seen.has(target)) continue
    seen.add(target)
    const name = nameOf(target)
    list.push({ target, name: typeof name === 'string' ? name.trim() : '', type: targetType })
  }
  return list
}

/**
 * The outputs of `nodeId` in an editor graph, as the engine will see them: a target's name falls back
 * to its type's default (the engine merges `defaultConfig` under each node's config).
 */
export function graphBehaviorOutputs(graph: Graph, nodeId: NodeId, registry: { get(type: string): ComponentDef | undefined }): BehaviorOutput[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const links = graph.edges.flatMap((e) => {
    const t = e.source === nodeId ? byId.get(e.target) : undefined
    return t ? [{ target: t.id, targetType: t.type }] : []
  })
  const nameOf = (id: NodeId) => {
    const n = byId.get(id)
    if (!n) return undefined
    const def = registry.get(n.type)
    return (def ? { ...defaultConfig(def), ...n.config } : n.config).name
  }
  return behaviorTargets(links, nameOf).map(({ name, type }) => ({ name, type }))
}

export type BehaviorStatus = { kind: 'default' } | { kind: 'active'; handlers: number } | { kind: 'errors'; errors: DslError[] }

/**
 * What a behavior text does against these outputs, with the engine's rule: any error → the default
 * behavior plus a badge; no handlers (blank or comments only) → the default behavior.
 */
export function behaviorStatus(text: unknown, outputs: BehaviorOutput[]): BehaviorStatus {
  if (typeof text !== 'string' || text.trim() === '') return { kind: 'default' }
  const { program, errors } = compileBehavior(text, outputs)
  if (errors.length > 0) return { kind: 'errors', errors }
  return program.handlers.length === 0 ? { kind: 'default' } : { kind: 'active', handlers: program.handlers.length }
}
