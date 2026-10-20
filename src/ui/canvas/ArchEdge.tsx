import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps } from '@xyflow/react'
import { ruleLabel } from '../../engine/rules'
import type { EdgeRule } from '../../engine/types'
import { boxOf, cubicPoint, curvePath, edgePoint } from '../geometry'

export type ArchEdgeData = { rule?: EdgeRule }
export type ArchFlowEdge = Edge<ArchEdgeData, 'arch'>

/** Floating edge: a horizontal cubic between the facing borders of both nodes. */
export function ArchEdge({ id, source, target, data, markerEnd, style, selected }: EdgeProps<ArchFlowEdge>) {
  const src = useInternalNode(source)
  const tgt = useInternalNode(target)
  if (!src?.measured.width || !tgt?.measured.width) return null
  const a = boxOf(src)
  const b = boxOf(tgt)
  const p0 = edgePoint(a, b)
  const p1 = edgePoint(b, a)
  const label = ruleLabel(data?.rule)
  const mid = cubicPoint(p0, p1, 0.5)
  return (
    <>
      <BaseEdge id={id} path={curvePath(p0, p1)} markerEnd={markerEnd} style={style} interactionWidth={16} />
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
