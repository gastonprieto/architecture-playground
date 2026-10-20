import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { defaultRegistry } from '../../components/index'
import type { NodeId } from '../../engine/types'
import { C, toneColor } from '../colors'

export type ArchNodeData = { kind: string; config: Record<string, unknown> }
export type ArchFlowNode = Node<ArchNodeData, 'arch'>

/**
 * Live counters slot (in flight, queued, ok, errors, up/down badge).
 * Task 18 replaces this body; it renders nothing for now.
 */
export function NodeStatsSlot(_props: { nodeId: NodeId }) {
  return null
}

export function ArchNode({ id, data, selected }: NodeProps<ArchFlowNode>) {
  const def = defaultRegistry.get(data.kind)
  const color = def ? toneColor(def.color) : C.err
  const configName = typeof data.config.name === 'string' ? data.config.name.trim() : ''
  const name = configName || def?.label || data.kind
  return (
    <div
      className={`arch-node${selected ? ' selected' : ''}${def ? '' : ' unknown'}`}
      style={{ ['--node-color' as string]: color }}
    >
      <Handle type="target" position={Position.Left} className="arch-handle" />
      <div className="arch-node-head">
        <span className="arch-node-icon" aria-hidden>
          {def?.icon ?? '❓'}
        </span>
        <div className="arch-node-text">
          <div className="arch-node-name">{name}</div>
          <div className="arch-node-type">{def?.label ?? 'Desconocido'}</div>
        </div>
      </div>
      <NodeStatsSlot nodeId={id} />
      <Handle type="source" position={Position.Right} className="arch-handle" />
    </div>
  )
}
