import { useId, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { DEFAULT_WEIGHT } from '../engine/weights'
import type { DbKind } from '../components/database'
import { defaultRegistry } from '../components/index'
import { fieldVisible, type ComponentDef, type Field } from '../engine/registry'
import type { EdgeRule } from '../engine/types'
import { useLang, useT } from '../i18n'
import { actionLabel, colorName, componentLabel, fieldLabel, optionLabel, unknownTypeTitle } from '../i18n/componentText'
import { BehaviorField } from './fields/BehaviorField'
import { BooleanField } from './fields/BooleanField'
import { ColorField } from './fields/ColorField'
import { ListField } from './fields/ListField'
import { MixField, type MixRow } from './fields/MixField'
import { NumberField } from './fields/NumberField'
import { SelectField } from './fields/SelectField'
import { TextField } from './fields/TextField'
import { InfoButton } from './InfoDialog'
import { isWeightedLb, lbShares } from './lbWeights'
import { NodeStatusPanel } from './NodeStatusPanel'
import { useEditor } from './store/editor'
import { useInspectorTab, type InspectorTab } from './store/inspectorTab'
import { databaseKindPatch } from './sessions'
import { useBehaviorStatus } from './useBehaviorStatus'

export interface InspectorProps {
  runAction?: (nodeId: string, action: string) => void
}

interface FieldControlProps {
  nodeId: string
  def: ComponentDef
  fieldKey: string
  field: Field
  value: unknown
  /** The node's whole config, for labels that depend on another field (the Cliente mix). */
  config: Record<string, unknown>
  onChange(v: unknown): void
}

function FieldControl({ nodeId, def, fieldKey, field, value, config, onChange }: FieldControlProps) {
  const lang = useLang((s) => s.lang)
  const t = useT()
  // A Cliente's mix holds paths for requests and event types for events.
  const clientMix = def.type === 'client' && fieldKey === 'mix'
  const isEvent = config.kind === 'event'
  const label = clientMix ? t(isEvent ? 'inspector.mixEvents' : 'inspector.mixPaths') : fieldLabel(lang, def, fieldKey)
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
      return (
        <MixField
          label={label}
          placeholder={clientMix ? t(isEvent ? 'inspector.eventPlaceholder' : 'inspector.pathPlaceholder') : undefined}
          value={Array.isArray(value) ? (value as MixRow[]) : field.default}
          onChange={onChange}
        />
      )
    case 'list': {
      // Every list field so far (cacheable paths) treats an empty list as "all".
      const list = Array.isArray(value) ? (value as unknown[]).map(String) : field.default
      return <ListField label={label} hint={t('widgets.listEmptyAll')} value={list} onChange={onChange} />
    }
    case 'behavior':
      return <BehaviorField nodeId={nodeId} label={label} value={typeof value === 'string' ? value : field.default} />
  }
}

/** The compact "×N" number beside an action button; clamps to the field's range on blur or Enter. */
function ActionParam({ label, field, value, onChange }: { label: string; field: Extract<Field, { type: 'number' }>; value: number; onChange(v: number): void }) {
  // What the user is typing, until blur/Enter; otherwise the input shows the stored value.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? String(value)
  const commit = () => {
    const n = Number(text)
    const v = text.trim() === '' || Number.isNaN(n) ? value : Math.min(field.max, Math.max(field.min, Math.round(n)))
    setDraft(null)
    if (v !== value) onChange(v)
  }
  return (
    <label className="action-param" title={label}>
      <span aria-hidden>×</span>
      <input
        type="number"
        aria-label={label}
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  )
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

/** Fields a valid behavior DSL replaces, per component type (they are dimmed while one is active). */
const OVERRIDDEN_BY_BEHAVIOR: Record<string, string[]> = { service: ['mode'], worker: ['failRate'], subscriber: ['emits'] }

function NodeInspector({ id, runAction }: { id: string; runAction?: InspectorProps['runAction'] }) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id))
  const behavior = useBehaviorStatus(id, node?.config.behavior)
  const updateNodeConfig = useEditor((s) => s.updateNodeConfig)
  const removeElements = useEditor((s) => s.removeElements)
  const lang = useLang((s) => s.lang)
  const t = useT()
  const tab = useInspectorTab((s) => s.tab)
  const setTab = useInspectorTab((s) => s.setTab)
  const tabsId = useId()
  if (!node) return null
  const def = defaultRegistry.get(node.type)
  // A database Tipo change brings its suggested processingTime along (one undo step, spec §5).
  const patchFor = (key: string, v: unknown): Record<string, unknown> =>
    def?.type === 'database' && key === 'kind' ? databaseKindPatch(node.config, v as DbKind) : { [key]: v }
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
  const actions = Object.entries(def.actions ?? {}).filter(([, a]) => !a.hidden)
  const actionParams = new Set(actions.flatMap(([, a]) => (a.param ? [a.param] : [])))
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'status', label: t('inspector.tabStatus') },
    { id: 'config', label: t('inspector.tabConfig') },
  ]
  // Tabs pattern: arrows move between tabs (and select them), the active one is the only tab stop.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = tabs[(tabs.findIndex((x) => x.id === tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id
    setTab(next)
    document.getElementById(`${tabsId}-tab-${next}`)?.focus()
  }
  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <h2 className="panel-title">
          <span aria-hidden>{def.iconFor?.(node.config) ?? def.icon}</span> {componentLabel(lang, def.type, def)}
        </h2>
        <InfoButton type={def.type} label={componentLabel(lang, def.type, def)} />
      </div>
      {actions.length > 0 && (
        <div className="inspector-actions">
          {actions.map(([name, action]) => {
            const param = action.param ? def.config[action.param] : undefined
            const button = (
              <button key={name} type="button" disabled={!runAction} onClick={() => runAction?.(id, name)}>
                {actionLabel(lang, def, name)}
              </button>
            )
            if (!action.param || param?.type !== 'number') return button
            return (
              <span key={name} className="action-group">
                {button}
                <ActionParam
                  label={fieldLabel(lang, def, action.param)}
                  field={param}
                  value={typeof node.config[action.param] === 'number' ? (node.config[action.param] as number) : param.default}
                  onChange={(v) => updateNodeConfig(id, { [action.param!]: v })}
                />
              </span>
            )
          })}
        </div>
      )}
      <div className="inspector-tabs" role="tablist" aria-label={t('inspector.tabsLabel')}>
        {tabs.map((x) => (
          <button
            key={x.id}
            id={`${tabsId}-tab-${x.id}`}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            aria-controls={`${tabsId}-panel-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1}
            className={tab === x.id ? 'active' : undefined}
            onClick={() => setTab(x.id)}
            onKeyDown={onTabKey}
          >
            {x.label}
          </button>
        ))}
      </div>
      {/* Both panels stay mounted (the hidden one keeps its local input state); only the active one shows. */}
      <div id={`${tabsId}-panel-status`} role="tabpanel" aria-labelledby={`${tabsId}-tab-status`} hidden={tab !== 'status'} className="inspector-panel">
        <NodeStatusPanel nodeId={id} kind={def.type} config={node.config} />
      </div>
      <div id={`${tabsId}-panel-config`} role="tabpanel" aria-labelledby={`${tabsId}-tab-config`} hidden={tab !== 'config'} className="inspector-panel">
        {Object.entries(def.config).map(([key, field]) => {
          // The action params live in the actions strip, always visible.
          if (actionParams.has(key) || !fieldVisible(field, node.config, def)) return null
          const control = (
            <FieldControl
              key={key}
              nodeId={id}
              def={def}
              fieldKey={key}
              field={field}
              value={node.config[key]}
              config={node.config}
              onChange={(v) => updateNodeConfig(id, patchFor(key, v))}
            />
          )
          if (behavior.kind !== 'active' || !OVERRIDDEN_BY_BEHAVIOR[def.type]?.includes(key)) return control
          return (
            <div key={key} className="field-overridden">
              {control}
              <p className="field-note">{t('behavior.overridden')}</p>
            </div>
          )
        })}
        {def.type === 'load-balancer' && node.config.algorithm === 'weighted' && <WeightsSection lbId={id} />}
      </div>
      {del}
    </div>
  )
}

export function Inspector({ runAction }: InspectorProps) {
  const selection = useEditor((s) => s.selection)
  const t = useT()
  const reduce = useReducedMotion()
  // One key per inspector "screen" (empty / an edge / a node): changing it animates the swap;
  // editing fields within the same selection keeps the key, so no re-animation on every keystroke.
  const key = !selection ? 'empty' : `${selection.kind}:${selection.id}`
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={key}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        {!selection ? (
          <p className="inspector-help">{t('inspector.help')}</p>
        ) : selection.kind === 'edge' ? (
          <EdgeInspector id={selection.id} />
        ) : (
          <NodeInspector id={selection.id} runAction={runAction} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}
