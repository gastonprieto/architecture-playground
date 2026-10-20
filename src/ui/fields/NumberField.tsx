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

  /** Parse and clamp the buffered text, write it to the store, and resync the text. */
  const commit = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n)) return setText(String(value))
    const c = clamp(n, min, max)
    setText(String(c))
    if (c !== value) onChange(c)
  }

  // While typing, only propagate values that are already in range; clamping waits for blur/Enter.
  const onType = (raw: string) => {
    setText(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && !Number.isNaN(n) && n >= min && n <= max && n !== value) onChange(n)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row">
        <input type="range" aria-label={`${label} (deslizador)`} min={min} max={max} step={step} value={value} onChange={(e) => onChange(clamp(Number(e.target.value), min, max))} />
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
          onBlur={(e) => commit(e.target.value)}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </div>
    </div>
  )
}
