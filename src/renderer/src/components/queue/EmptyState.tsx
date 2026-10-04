import type { JSX } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../icons/Icon'
import { SmallButton } from '../ui/Button'

/** Centred empty block (spec 4.12): no drop zone, an outlined button instead. */
export function EmptyState({
  icon,
  title,
  line,
  action
}: {
  icon: IconName
  title: string
  line: string
  action?: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="et">{title}</div>
      <div className="el">{line}</div>
      {action && (
        <SmallButton icon="addfile" onClick={action.onClick}>
          {action.label}
        </SmallButton>
      )}
    </div>
  )
}
