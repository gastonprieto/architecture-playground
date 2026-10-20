import { useId } from 'react'
import { DEFAULT_WEIGHT } from '../engine/weights'
import { defaultRegistry } from '../components/index'
import type { ComponentDef, Field } from '../engine/registry'
import type { EdgeRule } from '../engine/types'
import { useLang, useT } from '../i18n'
import { actionLabel, colorName, componentLabel, fieldLabel, optionLabel, unknownTypeTitle } from '../i18n/componentText'
import { BooleanField } from './fields/BooleanField'
import { ColorField } from './fields/ColorField'
import { MixField, type MixRow } from './fields/MixField'
import { NumberField } from './fields/NumberField'
import { SelectField } from './fields/SelectField'
import { TextField } from './fields/TextField'
import { InfoButton } from './InfoDialog'
import { isWeightedLb, lbShares } from './lbWeights'
import { useEditor } from './store/editor'

export interface InspectorProps {
  runAction?: (nodeId: string, action: string) => void
}

interface FieldControlProps {
  def: ComponentDef
  fieldKey: string
  field: Field
  value: unknown
  onChange(v: unknown): void
}

function FieldControl({ def, fieldKey, field, value, onChange }: FieldControlProps) {
  const lang = useLang((s) => s.lang)
  const label = fieldLabel(lang, def, fieldKey)
  switch (field.type) {
    case 'number':
      return <NumberField {...field} label={label} value={typeof value === 'number' ? value : field.default} onChange={onChange} />
    case 'boolean':
      return <BooleanField label={label} value={typeof value === 'boolean' ? value : field.default} onChange={onChange} />
    case 'select': {
      const options = field.options.map((o) => ({ value: o.value, label: optionLabel(lang, def, fieldKey, o.value) }))
      return <SelectField label={label} options={options} value={typeof value === 'string' ? value : field.default} onChange={onChange} />
    }
    case 'text':
      return <TextField label={label} value={typeof value === 'string' ? value : field.default} onChange={onChange} />
    case 'color':
      return (
        <ColorField
          label={label}
          options={field.options}
          value={typeof value === 'string' ? value : field.default}
          nameOf={(c) => colorName(lang, c)}
          onChange={onChange}
        />
      )
    case 'mix':
      return <MixField label={label} value={Array.isArray(value) ? (value as MixRow[]) : field.default} onChange={onChange} />
  }
}

/** Slider range; an imported larger weight widens it instead of being clamped. */
const WEIGHT_MAX = 100

/** Effective % of a connection; a down target is marked (it gets nothing while health checks are on). */
function Share({ pct, down }: { pct: number; down?: boolean }) {
  const t = useT()
  return (
    <>
      <span className="weight-share">{pct}%</span>
      {down && <span className="weight-down">({t('node.down')})</span>}
    </>
  )
}

/** "Pesos": one relative weight per outgoing connection of a weighted LB, with its effective %. */
function WeightsSection({ lbId }: { lbId: string }) {
  const graph = useEditor((s) => s.graph)
  const setEdgeWeight = useEditor((s) => s.setEdgeWeight)
  const t = useT()
  const titleId = useId()
  const rows = lbShares(graph, lbId)
  const nameOf = (nodeId: string) => {
    const n = graph.nodes.find((x) => x.id === nodeId)
    return typeof n?.config.name === 'string' && n.config.name.trim() ? n.config.name : nodeId
  }
  return (
    <section className="weights" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="weights-title">
        {t('inspector.weights')}
      </h3>
      <p className="weights-hint">{t('inspector.weightsHint')}</p>
      {rows.length === 0 && <p className="weights-hint">{t('inspector.weightsEmpty')}</p>}
      {rows.map(({ edge, share, down }) => (
        <NumberField
          key={edge.id}
          label={nameOf(edge.target)}
          value={edge.weight ?? DEFAULT_WEIGHT}
          min={0}
          max={Math.max(WEIGHT_MAX, edge.weight ?? 0)}
          step={1}
          extra={<Share pct={share} down={down} />}
          onChange={(v) => setEdgeWeight(edge.id, v)}
        />
      ))}
    </section>
  )
}

function EdgeInspector({ id }: { id: string }) {
  const graph = useEditor((s) => s.graph)
  const setEdgeRule = useEditor((s) => s.setEdgeRule)
  const setEdgeWeight = useEditor((s) => s.setEdgeWeight)
  const removeElements = useEditor((s) => s.removeElements)
  const valueId = useId()
  const t = useT()
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
      <h2 className="panel-title">{t('inspector.connection')}</h2>
      <p className="inspector-edge">
        {nameOf(edge.source)} → {nameOf(edge.target)}
      </p>
      <SelectField
        label={t('inspector.rule')}
        value={rule?.kind ?? ''}
        options={[
          { value: '', label: t('inspector.noRule') },
          { value: 'pathPrefix', label: t('inspector.pathPrefix') },
          { value: 'eventType', label: t('inspector.eventType') },
        ]}
        onChange={setKind}
      />
      {isWeightedLb(graph, edge.source) && (
        <NumberField
          label={t('inspector.weight')}
          value={edge.weight ?? DEFAULT_WEIGHT}
          min={0}
          max={Math.max(WEIGHT_MAX, edge.weight ?? 0)}
          step={1}
          extra={(() => {
            const row = lbShares(graph, edge.source).find((r) => r.edge.id === id)
            return <Share pct={row?.share ?? 0} down={row?.down} />
          })()}
          onChange={(v) => setEdgeWeight(id, v)}
        />
      )}
      {rule && (
        <div className="field">
          <label htmlFor={valueId}>{t('inspector.value')}</label>
          <input
            id={valueId}
            type="text"
            value={rule.value}
            placeholder={t(rule.kind === 'pathPrefix' ? 'inspector.pathPlaceholder' : 'inspector.eventPlaceholder')}
            onChange={(e) => setEdgeRule(id, { kind: rule.kind, value: e.target.value })}
          />
        </div>
      )}
      <button type="button" className="danger" onClick={() => removeElements([id])}>
        {t('inspector.delete')}
      </button>
    </div>
  )
}

function NodeInspector({ id, runAction }: { id: string; runAction?: InspectorProps['runAction'] }) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id))
  const updateNodeConfig = useEditor((s) => s.updateNodeConfig)
  const removeElements = useEditor((s) => s.removeElements)
  const lang = useLang((s) => s.lang)
  const t = useT()
  if (!node) return null
  const def = defaultRegistry.get(node.type)
  const del = (
    <button type="button" className="danger" onClick={() => removeElements([id])}>
      {t('inspector.delete')}
    </button>
  )
  if (!def) {
    return (
      <div className="inspector-body">
        <h2 className="panel-title">{unknownTypeTitle(lang, node.type)}</h2>
        {del}
      </div>
    )
  }
  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <h2 className="panel-title">
          <span aria-hidden>{def.icon}</span> {componentLabel(lang, def.type, def)}
        </h2>
        <InfoButton type={def.type} label={componentLabel(lang, def.type, def)} />
      </div>
      {Object.entries(def.config).map(([key, field]) => (
        <FieldControl key={key} def={def} fieldKey={key} field={field} value={node.config[key]} onChange={(v) => updateNodeConfig(id, { [key]: v })} />
      ))}
      {def.type === 'load-balancer' && node.config.algorithm === 'weighted' && <WeightsSection lbId={id} />}
      {def.actions && (
        <div className="inspector-actions">
          {Object.keys(def.actions).map((name) => (
            <button key={name} type="button" disabled={!runAction} onClick={() => runAction?.(id, name)}>
              {actionLabel(lang, def, name)}
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
  const t = useT()
  if (!selection) return <p className="inspector-help">{t('inspector.help')}</p>
  return selection.kind === 'edge' ? (
    <EdgeInspector key={`edge:${selection.id}`} id={selection.id} />
  ) : (
    <NodeInspector key={`node:${selection.id}`} id={selection.id} runAction={runAction} />
  )
}
