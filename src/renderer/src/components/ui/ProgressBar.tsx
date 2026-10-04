import type { JSX } from 'react'

/** 2px track with an fg1 fill; a null value is an indeterminate sweep (static
 * under reduced motion). Replaces the three copies in the tool setup cards. */
export function ProgressBar({
  value,
  label,
  wide
}: {
  value?: number | null
  label: string
  wide?: boolean
}): JSX.Element {
  const ind = value == null
  return (
    <div
      className={`mini${wide ? ' wide' : ''}${ind ? ' ind' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ind ? undefined : Math.round(value)}
    >
      <i style={ind ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
