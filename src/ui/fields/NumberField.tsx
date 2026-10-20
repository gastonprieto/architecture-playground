import { useEffect, useId, useState } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange(value: number): void
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function NumberField({ label, value, min, max, step = 1, unit, onChange }: Props) {
  const id = useId()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const commit = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n)) return setText(String(value))
    const c = clamp(n, min, max)
    setText(String(c))
    if (c !== value) onChange(c)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row">
        <input type="range" aria-label={`${label} (deslizador)`} min={min} max={max} step={step} value={value} onChange={(e) => commit(e.target.value)} />
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value.trim() !== '') commit(e.target.value)
          }}
          onBlur={(e) => commit(e.target.value)}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </div>
    </div>
  )
}
