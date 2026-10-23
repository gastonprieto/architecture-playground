import type { DragEvent } from 'react'
import { defaultRegistry } from '../components/index'
import type { ComponentDef } from '../engine/registry'
import { useLang, useT } from '../i18n'
import { componentLabel } from '../i18n/componentText'
import { toneColor } from './colors'
import { InfoButton } from './InfoDialog'

/** dataTransfer type carrying the component type from a palette tile to the canvas. */
export const ARCH_TYPE_MIME = 'application/x-arch-type'

/** Palette groups in display order; a component with no group falls into 'other' (shown last). */
type Group = NonNullable<ComponentDef['group']> | 'other'
const GROUP_ORDER: Group[] = ['edge', 'compute', 'data', 'messaging', 'other']

export function Palette() {
  const lang = useLang((s) => s.lang)
  const t = useT()
  const onDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData(ARCH_TYPE_MIME, type)
    e.dataTransfer.effectAllowed = 'move'
  }
  // Group the registered components, keeping registration order within each group.
  const byGroup = new Map<Group, ComponentDef[]>()
  for (const def of defaultRegistry.list()) {
    const g: Group = def.group ?? 'other'
    ;(byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(def)
  }
  return (
    <nav className="palette" aria-label={t('palette.title')}>
      <h2 className="panel-title">{t('palette.title')}</h2>
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => (
        <section key={g} className="palette-group">
          {g !== 'other' && <h3 className="palette-group-title">{t(`palette.groups.${g}`)}</h3>}
          <ul className="palette-list">
            {byGroup.get(g)!.map((def) => {
              const label = componentLabel(lang, def.type, def)
              return (
                <li key={def.type} className="palette-tile" style={{ ['--node-color' as string]: toneColor(def.color) }}>
                  {/* Only this part drags, so the ⓘ button next to it is a plain click. */}
                  <div className="palette-drag" draggable onDragStart={(e) => onDragStart(e, def.type)} title={t('palette.dragHint', { label })}>
                    <span className="palette-icon" aria-hidden>
                      {def.icon}
                    </span>
                    <span>{label}</span>
                  </div>
                  <InfoButton type={def.type} label={label} />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}
