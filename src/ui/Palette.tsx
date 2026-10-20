import type { DragEvent } from 'react'
import { defaultRegistry } from '../components/index'
import { toneColor } from './colors'

/** dataTransfer type carrying the component type from a palette tile to the canvas. */
export const ARCH_TYPE_MIME = 'application/x-arch-type'

export function Palette() {
  const onDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData(ARCH_TYPE_MIME, type)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <nav className="palette" aria-label="Componentes">
      <h2 className="panel-title">Componentes</h2>
      <ul className="palette-list">
        {defaultRegistry.list().map((def) => (
          <li
            key={def.type}
            className="palette-tile"
            draggable
            onDragStart={(e) => onDragStart(e, def.type)}
            style={{ ['--node-color' as string]: toneColor(def.color) }}
            title={`Arrastrá ${def.label} al canvas`}
          >
            <span className="palette-icon" aria-hidden>
              {def.icon}
            </span>
            <span>{def.label}</span>
          </li>
        ))}
      </ul>
    </nav>
  )
}
