import type { JSX } from 'react'
import type { IconName } from '@shared/icons'
import { ICON_SHAPES } from './shapes'

export function Icon({
  name,
  size = 16,
  strokeWidth,
  className = ''
}: {
  name: IconName
  size?: 16 | 12 | 10
  strokeWidth?: number
  className?: string
}): JSX.Element {
  const cls = `i${size === 12 ? ' i12' : size === 10 ? ' i10' : ''}${className ? ' ' + className : ''}`
  return (
    <svg
      className={cls}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={strokeWidth ? { strokeWidth } : undefined}
    >
      {ICON_SHAPES[name].map((p, i) =>
        p[0] === 'path' ? (
          <path key={i} d={p[1]} />
        ) : p[0] === 'rect' ? (
          <rect key={i} x={p[1]} y={p[2]} width={p[3]} height={p[4]} />
        ) : (
          <circle key={i} cx={p[1]} cy={p[2]} r={p[3]} />
        )
      )}
    </svg>
  )
}
