import { useRef, type JSX } from 'react'
import { rovingIndex } from './roving'

export interface Chip<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

export function ChipGrid<T extends string | number>({
  value,
  chips,
  onChange,
  label,
  cols = 4
}: {
  value: T | null
  chips: Chip<T>[]
  onChange: (v: T) => void
  label: string
  cols?: number
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = chips.findIndex((c) => c.value === value && !c.disabled)
  const focusIdx =
    idx >= 0
      ? idx
      : Math.max(
          0,
          chips.findIndex((c) => !c.disabled)
        )
  return (
    <div
      className="chips"
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {chips.map((c, i) => (
        <button
          key={String(c.value)}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={i === idx}
          aria-disabled={c.disabled || undefined}
          tabIndex={i === focusIdx ? 0 : -1}
          title={c.title}
          className={`chip${i === idx ? ' on' : ''}`}
          onClick={() => !c.disabled && onChange(c.value)}
          onKeyDown={(e) => {
            let n = rovingIndex(e.key, i, chips.length)
            if (n == null) return
            e.preventDefault()
            const dir = e.key === 'ArrowLeft' || e.key === 'End' ? -1 : 1
            for (let s = 0; s < chips.length && chips[n].disabled; s++)
              n = (n + dir + chips.length) % chips.length
            if (chips[n].disabled) return
            onChange(chips[n].value)
            refs.current[n]?.focus()
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
