import { useMemo } from 'react'
import { behaviorStatus, graphBehaviorOutputs, type BehaviorOutput, type BehaviorStatus } from '../components/behavior'
import type { NodeId } from '../engine/types'
import { useEditor } from './store/editor'

const isBlank = (text: unknown) => typeof text !== 'string' || text.trim() === ''

/**
 * The node's outputs as the engine's DSL sees them, re-read when a connection or a target's name
 * changes (the selector returns a string, so other graph edits do not re-render). Skipped while
 * `text` is blank: a blank behavior needs no outputs.
 */
function useBehaviorOutputs(nodeId: NodeId, text: unknown): BehaviorOutput[] {
  const key = useEditor((s) => (isBlank(text) ? '[]' : JSON.stringify(graphBehaviorOutputs(s.graph, nodeId))))
  return useMemo(() => JSON.parse(key) as BehaviorOutput[], [key])
}

/** Default / active / errors of `text` validated against the node's current outputs. */
export function useBehaviorStatus(nodeId: NodeId, text: unknown): BehaviorStatus {
  const outputs = useBehaviorOutputs(nodeId, text)
  return useMemo(() => behaviorStatus(text, outputs), [text, outputs])
}
