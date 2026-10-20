import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { defaultRegistry } from '../../components/index'
import type { Message, NodeId } from '../../engine/types'
import { C, toneColor } from '../colors'
import { ZERO_STATS, useRuntime } from '../runtime/runtimeStore'
import { UI_CELLS, type CellsView, type UiState } from '../runtime/useSimulation'
import { useEditor } from '../store/editor'
import { colorFor } from './PacketLayer'

export type ArchNodeData = { kind: string; config: Record<string, unknown> }
export type ArchFlowNode = Node<ArchNodeData, 'arch'>

const LANE_LABEL_MAX = 8

/** 1234 → '1234', 12345 → '12.3k' (keeps the counters row narrow). */
function compact(n: number): string {
  if (n < 10_000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function cellColor(kind: string, msg: Message): string {
  if (kind === 'dlq') return C.err
  if ((msg.attempt ?? 0) > 0) return C.slow
  return colorFor(msg)
}

/** Up to UI_CELLS cells plus "+N" for the rest. */
function Cells({ cells, kind }: { cells: CellsView; kind: string }) {
  const shown = cells.head.slice(0, UI_CELLS)
  return (
    <span className="node-cells">
      {shown.map((m, i) => (
        <span key={i} className="node-cell" style={{ background: cellColor(kind, m) }} />
      ))}
      {cells.total > shown.length && <span className="node-cells-more">+{cells.total - shown.length}</span>}
    </span>
  )
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Live counters, the down badge and queue/DLQ cells or broker lanes. */
export function NodeStatsSlot({ nodeId, kind, config }: { nodeId: NodeId; kind: string; config: Record<string, unknown> }) {
  const stats = useRuntime((s) => s.stats[nodeId]) ?? ZERO_STATS
  const ui = useRuntime((s) => s.states[nodeId]) as UiState | undefined
  const nodes = useEditor((s) => (ui?.lanes ? s.graph.nodes : null))
  const nameOf = (id: NodeId) => {
    const n = nodes?.find((x) => x.id === id)
    const name = typeof n?.config.name === 'string' ? n.config.name.trim() : ''
    return name || id
  }
  const lanes = ui?.lanes ? Object.entries(ui.lanes).filter(([id]) => nodes?.some((n) => n.id === id)) : []
  return (
    <div className="node-stats">
      <div className="node-counters">
        {config.up === false && <span className="node-down">caído</span>}
        {stats.inFlight > 0 && <span title="En proceso">⏳ {compact(stats.inFlight)}</span>}
        {stats.queued > 0 && <span title="En cola">☰ {compact(stats.queued)}</span>}
        <span title="OK" className="node-ok">✔ {compact(stats.ok)}</span>
        <span title="Errores" className={stats.errors > 0 ? 'node-err' : 'node-zero'}>✖ {compact(stats.errors)}</span>
      </div>
      {ui?.items && (kind === 'queue' || kind === 'dlq') && <Cells cells={ui.items} kind={kind} />}
      {lanes.map(([id, cells]) => (
        <div key={id} className="node-lane">
          <span className="node-lane-label" title={nameOf(id)}>
            {truncate(nameOf(id), LANE_LABEL_MAX)}
          </span>
          <Cells cells={cells} kind={kind} />
        </div>
      ))}
    </div>
  )
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
      <NodeStatsSlot nodeId={id} kind={data.kind} config={data.config} />
      <Handle type="source" position={Position.Right} className="arch-handle" />
    </div>
  )
}
