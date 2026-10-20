import type { ComponentDef } from '../engine/registry'
import { lookup, translate, type Lang } from './index'

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
