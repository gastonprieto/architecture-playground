import { useId } from 'react'
import { defaultRegistry } from '../components/index'
import type { Field } from '../engine/registry'
import type { EdgeRule } from '../engine/types'
import { BooleanField } from './fields/BooleanField'
import { MixField, type MixRow } from './fields/MixField'
import { NumberField } from './fields/NumberField'
import { SelectField } from './fields/SelectField'
import { TextField } from './fields/TextField'
import { useEditor } from './store/editor'

export interface InspectorProps {
  runAction?: (nodeId: string, action: string) => void
}

function FieldControl({ field, value, onChange }: { field: Field; value: unknown; onChange(v: unknown): void }) {
  switch (field.type) {
    case 'number':
      return <NumberField {...field} value={typeof value === 'number' ? value : field.default} onChange={onChange} />
    case 'boolean':
      return <BooleanField label={field.label} value={typeof value === 'boolean' ? value : field.default} onChange={onChange} />
    case 'select':
      return <SelectField label={field.label} options={field.options} value={typeof value === 'string' ? value : field.default} onChange={onChange} />
    case 'text':
      return <TextField label={field.label} value={typeof value === 'string' ? value : field.default} onChange={onChange} />
    case 'mix':
      return <MixField label={field.label} value={Array.isArray(value) ? (value as MixRow[]) : field.default} onChange={onChange} />
  }
}

function EdgeInspector({ id }: { id: string }) {
  const graph = useEditor((s) => s.graph)
  const setEdgeRule = useEditor((s) => s.setEdgeRule)
  const removeElements = useEditor((s) => s.removeElements)
  const valueId = useId()
  const edge = graph.edges.find((e) => e.id === id)
  if (!edge) return null
  const nameOf = (nodeId: string) => {
    const n = graph.nodes.find((x) => x.id === nodeId)
    return typeof n?.config.name === 'string' ? n.config.name : nodeId
  }
  const rule = edge.rule
  const setKind = (kind: string) =>
    setEdgeRule(id, kind === '' ? undefined : { kind: kind as EdgeRule['kind'], value: rule?.value ?? '' })
  return (
    <div className="inspector-body">
      <h2 className="panel-title">Conexión</h2>
      <p className="inspector-edge">
        {nameOf(edge.source)} → {nameOf(edge.target)}
      </p>
      <SelectField
        label="Regla"
        value={rule?.kind ?? ''}
        options={[
          { value: '', label: 'Sin regla' },
          { value: 'pathPrefix', label: 'Path empieza con' },
          { value: 'eventType', label: 'Tipo de evento' },
        ]}
        onChange={setKind}
      />
      {rule && (
        <div className="field">
          <label htmlFor={valueId}>Valor</label>
          <input
            id={valueId}
            type="text"
            value={rule.value}
            placeholder={rule.kind === 'pathPrefix' ? '/ordenes' : 'order.created'}
            onChange={(e) => setEdgeRule(id, { kind: rule.kind, value: e.target.value })}
          />
        </div>
      )}
      <button type="button" className="danger" onClick={() => removeElements([id])}>
        Borrar
      </button>
    </div>
  )
}

function NodeInspector({ id, runAction }: { id: string; runAction?: InspectorProps['runAction'] }) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id))
  const updateNodeConfig = useEditor((s) => s.updateNodeConfig)
  const removeElements = useEditor((s) => s.removeElements)
  if (!node) return null
  const def = defaultRegistry.get(node.type)
  const del = (
    <button type="button" className="danger" onClick={() => removeElements([id])}>
      Borrar
    </button>
  )
  if (!def) {
    return (
      <div className="inspector-body">
        <h2 className="panel-title">Tipo desconocido: {node.type}</h2>
        {del}
      </div>
    )
  }
  return (
    <div className="inspector-body">
      <h2 className="panel-title">
        <span aria-hidden>{def.icon}</span> {def.label}
      </h2>
      {Object.entries(def.config).map(([key, field]) => (
        <FieldControl key={key} field={field} value={node.config[key]} onChange={(v) => updateNodeConfig(id, { [key]: v })} />
      ))}
      {def.actions && (
        <div className="inspector-actions">
          {Object.entries(def.actions).map(([name, action]) => (
            <button key={name} type="button" disabled={!runAction} onClick={() => runAction?.(id, name)}>
              {action.label}
            </button>
          ))}
        </div>
      )}
      {del}
    </div>
  )
}

export function Inspector({ runAction }: InspectorProps) {
  const selection = useEditor((s) => s.selection)
  if (!selection) {
    return (
      <p className="inspector-help">Arrastrá componentes desde la izquierda y conectalos. Seleccioná uno para configurarlo.</p>
    )
  }
  return selection.kind === 'edge' ? (
    <EdgeInspector key={`edge:${selection.id}`} id={selection.id} />
  ) : (
    <NodeInspector key={`node:${selection.id}`} id={selection.id} runAction={runAction} />
  )
}
