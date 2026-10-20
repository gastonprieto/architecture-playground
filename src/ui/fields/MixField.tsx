import { useEffect, useId, useState } from 'react'
import { useT } from '../../i18n'

export type MixRow = { value: string; weight: number }

export function MixField({ label, value, onChange }: { label: string; value: MixRow[]; onChange(v: MixRow[]): void }) {
  const id = useId()
  const t = useT()
  const patch = (i: number, p: Partial<MixRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id} className="field-label">
        {label}
      </span>
      {value.map((row, i) => (
        <div className="field-row mix-row" key={i}>
          <input type="text" aria-label={t('widgets.mixValue', { n: i + 1 })} value={row.value} onChange={(e) => patch(i, { value: e.target.value })} />
          <WeightInput label={t('widgets.mixWeight', { n: i + 1 })} value={row.weight} onChange={(weight) => patch(i, { weight })} />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            {t('widgets.remove')}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { value: '', weight: 1 }])}>
        {t('widgets.add')}
      </button>
    </div>
  )
}

/** Number input that buffers its text so clearing it does not snap to 0 until blur. */
function WeightInput({ label, value, onChange }: { label: string; value: number; onChange(v: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText((t) => (Number(t) === value && t.trim() !== '' ? t : String(value))), [value])
  return (
    <input
      type="number"
      aria-label={label}
      min={0}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && !Number.isNaN(n)) onChange(Math.max(0, n))
      }}
      onBlur={() => {
        const n = Number(text)
        const w = text.trim() === '' || Number.isNaN(n) ? 0 : Math.max(0, n)
        setText(String(w))
        onChange(w)
      }}
    />
  )
}
