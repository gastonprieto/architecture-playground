import { useId, type KeyboardEvent } from 'react'

interface Props {
  label: string
  value: string
  options: readonly string[]
  /** Accessible name of each color (e.g. "Celeste"). */
  nameOf(color: string): string
  onChange(v: string): void
}

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/** Swatches as a radio group: click or arrow keys pick, the selected one is ringed. */
export function ColorField({ label, value, options, nameOf, onChange }: Props) {
  const id = useId()
  const selected = options.indexOf(value)
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = NEXT[e.key]
    if (step === undefined) return
    e.preventDefault()
    const j = (i + step + options.length) % options.length
    onChange(options[j])
    ;(e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus()
  }
  return (
    <div className="field">
      <span id={id} className="field-label">
        {label}
      </span>
      <div className="swatches" role="radiogroup" aria-labelledby={id}>
        {options.map((c, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            aria-label={nameOf(c)}
            title={nameOf(c)}
            tabIndex={c === value || (selected < 0 && i === 0) ? 0 : -1}
            className={`swatch${c === value ? ' selected' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            onKeyDown={(e) => onKeyDown(e, i)}
          />
        ))}
      </div>
    </div>
  )
}
