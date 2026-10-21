import { useId } from 'react'
import { useT } from '../../i18n'

/** An ordered list of strings: one text row each, like the Mix editor without weights. */
export function ListField({ label, hint, value, onChange }: { label: string; hint?: string; value: string[]; onChange(v: string[]): void }) {
  const id = useId()
  const t = useT()
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id} className="field-label">
        {label}
      </span>
      {hint && <p className="field-hint">{hint}</p>}
      {value.map((item, i) => (
        <div className="field-row list-row" key={i}>
          <input
            type="text"
            aria-label={t('widgets.mixValue', { n: i + 1 })}
            value={item}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            {t('widgets.remove')}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, ''])}>
        {t('widgets.add')}
      </button>
    </div>
  )
}
