import { useId } from 'react'

export type MixRow = { value: string; weight: number }

export function MixField({ label, value, onChange }: { label: string; value: MixRow[]; onChange(v: MixRow[]): void }) {
  const id = useId()
  const patch = (i: number, p: Partial<MixRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id} className="field-label">
        {label}
      </span>
      {value.map((row, i) => (
        <div className="field-row mix-row" key={i}>
          <input type="text" aria-label={`Valor ${i + 1}`} value={row.value} onChange={(e) => patch(i, { value: e.target.value })} />
          <input
            type="number"
            aria-label={`Peso ${i + 1}`}
            min={0}
            value={row.weight}
            onChange={(e) => patch(i, { weight: Math.max(0, Number(e.target.value) || 0) })}
          />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Quitar
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { value: '', weight: 1 }])}>
        Agregar
      </button>
    </div>
  )
}
