import { useId } from 'react'

export function BooleanField({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  const id = useId()
  return (
    <div className="field field-inline">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="switch" type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </div>
  )
}
