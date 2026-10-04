import type { CSSProperties, JSX } from 'react'

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
  ends
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  ends?: [string, string]
}): JSX.Element {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className="rng">
      <div className="rng-row">
        <input
          type="range"
          aria-label={label}
          aria-valuetext={format(value)}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ '--fill': `${fill}%` } as CSSProperties}
        />
        <output className="mono">{format(value)}</output>
      </div>
      {ends && (
        <div className="rng-ends mono">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  )
}
