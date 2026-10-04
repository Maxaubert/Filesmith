import { useState, type InputHTMLAttributes, type JSX } from 'react'

export function TextField({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input spellCheck={false} {...rest} className={`vs-in ${className}`} />
}

/** Commit-on-blur/Enter number input with optional clamping (replaces DimInput).
 * The draft exists only while editing, so no effect has to sync it. */
export function NumberField({
  value,
  onCommit,
  label,
  placeholder,
  clamp
}: {
  value: number | ''
  onCommit: (v: number | '') => void
  label: string
  placeholder?: string
  clamp?: (n: number) => number
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  function commit(): void {
    if (draft == null) return
    const t = draft.trim()
    if (t === '') onCommit('')
    else {
      const n = Number(t)
      if (Number.isFinite(n)) onCommit(clamp ? clamp(n) : n)
    }
    setDraft(null)
  }
  return (
    <input
      className="vs-in"
      inputMode="numeric"
      spellCheck={false}
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}
