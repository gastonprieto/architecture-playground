import type { EdgeRule } from './types'

/** Matched prefix length, or -1 for no match. A missing rule counts as '/' (length 1). */
export function matchesPath(rule: EdgeRule | undefined, path: string): number {
  if (!rule) return 1
  if (rule.kind !== 'pathPrefix') return -1
  return path.startsWith(rule.value) ? rule.value.length : -1
}

export function matchesEvent(rule: EdgeRule | undefined, eventType: string): boolean {
  if (!rule) return true
  return rule.kind === 'eventType' && rule.value === eventType
}

export function ruleLabel(rule?: EdgeRule): string {
  if (!rule) return ''
  return rule.kind === 'pathPrefix' ? `${rule.value}*` : rule.value
}
