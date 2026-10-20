import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
  type OnDelete,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { defaultRegistry } from '../../components/index'
import { C } from '../colors'
import { ARCH_TYPE_MIME } from '../Palette'
import { useEditor, type Selection } from '../store/editor'
import { ArchEdge, type ArchFlowEdge } from './ArchEdge'
import { ArchNode, type ArchFlowNode } from './ArchNode'

const nodeTypes: NodeTypes = { arch: ArchNode }
const edgeTypes: EdgeTypes = { arch: ArchEdge }
const DELETE_KEYS = ['Delete', 'Backspace']
/** A dropped node is placed so the cursor lands roughly on its center. */
const DROP_OFFSET = { x: 70, y: 24 }
const MARKER = { type: MarkerType.ArrowClosed, color: C.muted, width: 18, height: 18 }
/** Same color as the selected edge stroke (theme.css). */
const MARKER_SELECTED = { ...MARKER, color: 'var(--cyan)' }
/** Low enough for fitView to fit a preset on a phone-width canvas. */
const MIN_ZOOM = 0.2
const FIT_VIEW_OPTIONS = { padding: 0.15 }

type Size = { width: number; height: number }

const isSelected = (sel: Selection, kind: 'node' | 'edge', id: string) => sel?.kind === kind && sel.id === id

/** Applies React Flow 'select' changes to the single-element store selection. */
function applySelect(kind: 'node' | 'edge', changes: { type: string; id?: string; selected?: boolean }[]) {
  const { select } = useEditor.getState()
  for (const c of changes) {
    if (c.type !== 'select' || !c.id) continue
    if (c.selected) select({ kind, id: c.id })
    else if (isSelected(useEditor.getState().selection, kind, c.id)) select(null)
  }
}

export function Canvas({ readOnly = false }: { readOnly?: boolean }) {
  const graph = useEditor((s) => s.graph)
  const selection = useEditor((s) => s.selection)
  const { screenToFlowPosition, fitView } = useReactFlow()
  // React Flow only knows a node's size through `node.measured`, so measurements are cached here
  // (the graph itself is never copied; nodes/edges are derived from the store).
  const [sizes, setSizes] = useState<Record<string, Size>>({})

  const nodes = useMemo<ArchFlowNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'arch',
        position: n.position,
        data: { kind: n.type, config: n.config },
        selected: isSelected(selection, 'node', n.id),
        measured: sizes[n.id],
      })),
    [graph.nodes, selection, sizes],
  )

  const edges = useMemo<ArchFlowEdge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        type: 'arch',
        source: e.source,
        target: e.target,
        data: { rule: e.rule },
        selected: isSelected(selection, 'edge', e.id),
        markerEnd: isSelected(selection, 'edge', e.id) ? MARKER_SELECTED : MARKER,
      })),
    [graph.edges, selection],
  )

  // Entering/leaving read-only (mobile) mode changes the canvas size: refit, and drop the selection
  // since it can no longer be changed or inspected.
  const prevReadOnly = useRef(readOnly)
  useEffect(() => {
    if (prevReadOnly.current === readOnly) return
    prevReadOnly.current = readOnly
    if (readOnly) useEditor.getState().select(null)
    void fitView(FIT_VIEW_OPTIONS)
  }, [readOnly, fitView])

  const onNodesChange = useCallback((changes: NodeChange<ArchFlowNode>[]) => {
    const measured: Record<string, Size> = {}
    for (const c of changes) {
      if (c.type === 'position' && c.dragging && c.position) useEditor.getState().moveNode(c.id, c.position, false)
      else if (c.type === 'dimensions' && c.dimensions) measured[c.id] = c.dimensions
    }
    if (Object.keys(measured).length > 0) {
      setSizes((prev) => {
        const changed = Object.entries(measured).some(
          ([id, d]) => prev[id]?.width !== d.width || prev[id]?.height !== d.height,
        )
        return changed ? { ...prev, ...measured } : prev
      })
    }
    applySelect('node', changes)
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<ArchFlowEdge>[]) => applySelect('edge', changes), [])

  const onNodeDragStop = useCallback((_: unknown, node: ArchFlowNode) => {
    useEditor.getState().moveNode(node.id, node.position, true)
  }, [])

  const onConnect = useCallback((c: Connection) => {
    useEditor.getState().connect(c.source, c.target)
  }, [])

  // One removeElements call per delete keystroke, so a deletion is a single undo step.
  const onDelete: OnDelete<ArchFlowNode, ArchFlowEdge> = useCallback(({ nodes: ns, edges: es }) => {
    const ids = [...ns.map((n) => n.id), ...es.map((e) => e.id)]
    if (ids.length > 0) useEditor.getState().removeElements(ids)
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes(ARCH_TYPE_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(ARCH_TYPE_MIME)
      if (!type || !defaultRegistry.get(type)) return
      e.preventDefault()
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const { addNode, select } = useEditor.getState()
      const id = addNode(type, { x: Math.round(p.x - DROP_OFFSET.x), y: Math.round(p.y - DROP_OFFSET.y) })
      select({ kind: 'node', id })
    },
    [screenToFlowPosition],
  )

  return (
    <ReactFlow<ArchFlowNode, ArchFlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onDelete={onDelete}
      onDragOver={readOnly ? undefined : onDragOver}
      onDrop={readOnly ? undefined : onDrop}
      connectionMode={ConnectionMode.Loose}
      deleteKeyCode={readOnly ? null : DELETE_KEYS}
      multiSelectionKeyCode={null}
      selectionKeyCode={null}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      elementsSelectable={!readOnly}
      colorMode="dark"
      minZoom={MIN_ZOOM}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--line)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
