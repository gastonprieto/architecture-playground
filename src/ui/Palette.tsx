import type { DragEvent } from 'react'
import { defaultRegistry } from '../components/index'
import { useLang, useT } from '../i18n'
import { componentLabel } from '../i18n/componentText'
import { toneColor } from './colors'

/** dataTransfer type carrying the component type from a palette tile to the canvas. */
export const ARCH_TYPE_MIME = 'application/x-arch-type'

export function Palette() {
  const lang = useLang((s) => s.lang)
  const t = useT()
  const onDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData(ARCH_TYPE_MIME, type)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <nav className="palette" aria-label={t('palette.title')}>
      <h2 className="panel-title">{t('palette.title')}</h2>
      <ul className="palette-list">
        {defaultRegistry.list().map((def) => {
          const label = componentLabel(lang, def.type, def)
          return (
            <li
              key={def.type}
              className="palette-tile"
              draggable
              onDragStart={(e) => onDragStart(e, def.type)}
              style={{ ['--node-color' as string]: toneColor(def.color) }}
              title={t('palette.dragHint', { label })}
            >
              <span className="palette-icon" aria-hidden>
                {def.icon}
              </span>
              <span>{label}</span>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
