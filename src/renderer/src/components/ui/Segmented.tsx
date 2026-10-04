import { useRef, type JSX } from 'react'
import { rovingIndex } from './roving'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = options.findIndex((o) => o.value === value)
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={i === idx}
          tabIndex={i === (idx < 0 ? 0 : idx) ? 0 : -1}
          className={i === idx ? 'on' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const n = rovingIndex(e.key, i, options.length)
            if (n == null) return
            e.preventDefault()
            onChange(options[n].value)
            refs.current[n]?.focus()
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
