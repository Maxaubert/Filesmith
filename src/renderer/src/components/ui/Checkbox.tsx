import type { JSX } from 'react'
import { Icon } from '../icons/Icon'

export function Checkbox({
  checked,
  onChange,
  label,
  size = 'sm',
  focusable = false
}: {
  checked: boolean | 'mixed'
  onChange: () => void
  label: string
  size?: 'sm' | 'md'
  /** Table rows take focus themselves, so row boxes are tabindex -1 (spec 4.1). */
  focusable?: boolean
}): JSX.Element {
  const on = checked === true
  return (
    <span
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : on}
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      className={`box${on ? ' on' : ''}${checked === 'mixed' ? ' mixed' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onChange()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onChange()
        }
      }}
    >
      {on && <Icon name="check" size={size === 'md' ? 12 : 10} strokeWidth={2} />}
    </span>
  )
}
