import { useId } from 'react'

export function TextField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
