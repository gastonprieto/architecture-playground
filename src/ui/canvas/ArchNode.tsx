import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { motion, useReducedMotion } from 'framer-motion'
import { dbKind, type DbKind } from '../../components/database'
import { defaultRegistry } from '../../components/index'
import type { Message, NodeId } from '../../engine/types'
import { useLang, useT } from '../../i18n'
import { componentLabel, optionLabel } from '../../i18n/componentText'
import { C, toneColor } from '../colors'
import { ZERO_STATS, useRuntime } from '../runtime/runtimeStore'
import { UI_CELLS, type CellsView, type UiState } from '../runtime/useSimulation'
import { useEditor } from '../store/editor'
import { cookieCounter } from '../sessions'
import { cacheCounters } from '../cacheCounters'
import { useBehaviorStatus } from '../useBehaviorStatus'
import { packetStyle } from './PacketLayer'

export type ArchNodeData = { kind: string; config: Record<string, unknown>; enterDelay?: number }
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
  return packetStyle(msg).fill
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

/** "DSL" when the node runs a behavior, "⚠ DSL" when it has errors (and runs the default); nothing when blank. */
function DslBadge({ nodeId, text }: { nodeId: NodeId; text: unknown }) {
  const t = useT()
  const status = useBehaviorStatus(nodeId, text)
  if (status.kind === 'default') return null
  const error = status.kind === 'errors'
  return (
    <span className={`node-dsl${error ? ' error' : ''}`} title={t(error ? 'behavior.badgeErrorsTitle' : 'behavior.badgeTitle')}>
      {t(error ? 'behavior.badgeErrors' : 'behavior.badge')}
    </span>
  )
}

/** Live counters, the down badge and queue/DLQ cells or broker lanes. */
export function NodeStatsSlot({ nodeId, kind, config }: { nodeId: NodeId; kind: string; config: Record<string, unknown> }) {
  const stats = useRuntime((s) => s.stats[nodeId]) ?? ZERO_STATS
  const t = useT()
  const ui = useRuntime((s) => s.states[nodeId]) as UiState | undefined
  const nodes = useEditor((s) => (ui?.lanes ? s.graph.nodes : null))
  const nameOf = (id: NodeId) => {
    const n = nodes?.find((x) => x.id === id)
    const name = typeof n?.config.name === 'string' ? n.config.name.trim() : ''
    return name || id
  }
  const hasBehavior = defaultRegistry.get(kind)?.config.behavior?.type === 'behavior'
  const lanes = ui?.lanes ? Object.entries(ui.lanes).filter(([id]) => nodes?.some((n) => n.id === id)) : []
  const cookies = cookieCounter(kind, config, ui)
  const cacheView = cacheCounters(kind, config, ui)
  return (
    <div className="node-stats">
      <div className="node-counters">
        {config.up === false && <span className="node-down">{t('node.down')}</span>}
        {hasBehavior && <DslBadge nodeId={nodeId} text={config.behavior} />}
        {cookies && (
          <span className="node-cookies" title={t(kind === 'client' ? 'node.loggedIn' : 'node.sessions')}>
            {cookies}
          </span>
        )}
        {cacheView.keys && (
          <span className="node-keys" title={t('node.cacheKeys')}>
            {cacheView.keys}
          </span>
        )}
        {cacheView.hit && (
          <span className="node-hit" title={t('node.hitRate')}>
            {cacheView.hit}
          </span>
        )}
        {stats.inFlight > 0 && <span title={t('node.inFlight')}>⏳ {compact(stats.inFlight)}</span>}
        {stats.queued > 0 && <span title={t('node.queued')}>☰ {compact(stats.queued)}</span>}
        <span title={t('node.ok')} className="node-ok">✔ {compact(stats.ok)}</span>
        <span title={t('node.errors')} className={stats.errors > 0 ? 'node-err' : 'node-zero'}>✖ {compact(stats.errors)}</span>
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
  const lang = useLang((s) => s.lang)
  const typeLabel = componentLabel(lang, data.kind, def)
  // A Base de datos also names its kind: "Base de datos · clave-valor".
  const subtitle =
    def && data.kind === 'database'
      ? `${typeLabel} · ${optionLabel(lang, def, 'kind', dbKind(data.config as { kind?: DbKind })).toLocaleLowerCase(lang)}`
      : typeLabel
  const icon = def ? (def.iconFor?.(data.config) ?? def.icon) : '❓'
  // A Cliente wears its own color (the one its packets carry).
  const own = data.kind === 'client' && typeof data.config.color === 'string' && data.config.color ? data.config.color : undefined
  const color = own ?? (def ? toneColor(def.color) : C.err)
  const configName = typeof data.config.name === 'string' ? data.config.name.trim() : ''
  const name = configName || (def ? typeLabel : data.kind)
  const hasIncoming = useEditor((s) => def?.inputs === false && s.graph.edges.some((e) => e.target === id))
  const reduced = useReducedMotion()
  const enterDelay = reduced ? 0 : (data.enterDelay ?? 0)
  return (
    <motion.div
      className={`arch-node${selected ? ' selected' : ''}${def ? '' : ' unknown'}`}
      style={{ ['--node-color' as string]: color }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: 'easeOut', delay: enterDelay }}
    >
      {def?.inputs !== false ? (
        <Handle type="target" position={Position.Left} className="arch-handle" />
      ) : (
        // Source-only components (Cliente) have no input port. React Flow only draws an edge that ends
        // at a target handle, so a legacy wire into one gets a hidden anchor that accepts nothing new.
        hasIncoming && <Handle type="target" position={Position.Left} className="arch-handle arch-handle-anchor" isConnectable={false} />
      )}
      <div className="arch-node-head">
        <span className="arch-node-icon" aria-hidden>
          {icon}
        </span>
        <div className="arch-node-text">
          <div className="arch-node-name">{name}</div>
          <div className="arch-node-type">{subtitle}</div>
        </div>
      </div>
      <NodeStatsSlot nodeId={id} kind={data.kind} config={data.config} />
      <Handle type="source" position={Position.Right} className="arch-handle" />
    </motion.div>
  )
}
