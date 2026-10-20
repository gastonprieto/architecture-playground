import type { ComponentDef } from '../engine/registry'
import { lookup, lookupList, translate, type Lang } from './index'

/*
 * Component defs keep their own (Spanish) texts as fallback; the UI shows them through these
 * helpers, which prefer the `components.<type>.*` keys so a component without translations
 * (e.g. a third-party one) still shows its def text.
 */

/** The type's display name; "Unknown" when the type is not registered. */
export function componentLabel(lang: Lang, type: string, def: ComponentDef | undefined): string {
  if (!def) return translate(lang, 'node.unknown')
  return lookup(lang, `components.${type}.label`) ?? def.label
}

/** A config field's label: component key, then the shared `fields.<key>`, then the def's label. */
export function fieldLabel(lang: Lang, def: ComponentDef, key: string): string {
  return lookup(lang, `components.${def.type}.fields.${key}`) ?? lookup(lang, `fields.${key}`) ?? def.config[key]?.label ?? key
}

export function optionLabel(lang: Lang, def: ComponentDef, fieldKey: string, value: string): string {
  const field = def.config[fieldKey]
  const own = field?.type === 'select' ? field.options.find((o) => o.value === value)?.label : undefined
  return lookup(lang, `components.${def.type}.options.${fieldKey}.${value}`) ?? own ?? value
}

export function actionLabel(lang: Lang, def: ComponentDef, name: string): string {
  return lookup(lang, `components.${def.type}.actions.${name}`) ?? def.actions?.[name]?.label ?? name
}

export const unknownTypeTitle = (lang: Lang, type: string): string => translate(lang, 'inspector.unknownType', { type })

export interface ComponentInfo {
  summary: string
  behavior: string[]
  /** Every config field of the def, in order, with its label and one-line help (if any). */
  fields: { key: string; label: string; help?: string }[]
  tip: string
}

/**
 * The info panel content of a type (`components.<type>.info`), or undefined when it has none (e.g. a
 * third-party component). Field help: the component's `info.fields.<key>`, then the shared `fieldInfo.<key>`.
 */
export function componentInfo(lang: Lang, def: ComponentDef): ComponentInfo | undefined {
  const base = `components.${def.type}.info`
  const summary = lookup(lang, `${base}.summary`)
  if (summary === undefined) return undefined
  const fields = Object.keys(def.config).map((key) => ({
    key,
    label: fieldLabel(lang, def, key),
    help: lookup(lang, `${base}.fields.${key}`) ?? lookup(lang, `fieldInfo.${key}`),
  }))
  return { summary, behavior: lookupList(lang, `${base}.behavior`) ?? [], fields, tip: lookup(lang, `${base}.tip`) ?? '' }
}

/** A palette color's name (`colorNames.<hex without #>`), or the hex itself. */
export const colorName = (lang: Lang, hex: string): string => lookup(lang, `colorNames.${hex.replace(/^#/, '').toLowerCase()}`) ?? hex
