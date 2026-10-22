import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps } from '@xyflow/react'
import { ruleLabel } from '../../engine/rules'
import { useT } from '../../i18n'
import type { EdgeRule } from '../../engine/types'
import { boxOf, portPoints, wirePath, wirePoint } from '../geometry'

/** `share`: effective % when the edge leaves a weighted load balancer. `pull`: consumer pulls from a queue/broker. */
export type ArchEdgeData = { rule?: EdgeRule; share?: number; down?: boolean; pull?: boolean }
export type ArchFlowEdge = Edge<ArchEdgeData, 'arch'>

/** Wire from the source's output port to the target's input port. */
export function ArchEdge({ id, source, target, data, markerStart, markerEnd, style, selected }: EdgeProps<ArchFlowEdge>) {
  const src = useInternalNode(source)
  const tgt = useInternalNode(target)
  const t = useT()
  if (!src?.measured.width || !tgt?.measured.width) return null
  const [p0, p1] = portPoints(boxOf(src), boxOf(tgt))
  const share = data?.share === undefined ? '' : `${data.share}%${data.down ? ` (${t('node.down')})` : ''}`
  const label = [ruleLabel(data?.rule), share].filter(Boolean).join(' · ')
  const mid = wirePoint(p0, p1, 0.5)
  return (
    <>
      <BaseEdge id={id} path={wirePath(p0, p1)} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={16} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`arch-edge-label${selected ? ' selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
