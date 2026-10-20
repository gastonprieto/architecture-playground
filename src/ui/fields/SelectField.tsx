import { useId } from 'react'

interface Props {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange(v: string): void
}

export function SelectField({ label, value, options, onChange }: Props) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
