import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { RowAction } from '../ui/Button'
import type { RowActionKind, RowActionView, StatusView } from './rowModel'

/** The status glyph and text (62%(4s), Done, the failed pill...). */
export function StatusBadge({ status }: { status: StatusView }): JSX.Element | null {
  if (status.kind === 'failed')
    return (
      <span className="st fail" title={status.title}>
        <Icon name="warning" />
        {status.text}
      </span>
    )
  if (status.kind === 'running')
    return (
      <span className="st run">
        <Icon name="sync" />
        <span className="prog">
          <b>{status.pct}</b>
          <span className="eta">{status.eta}</span>
        </span>
      </span>
    )
  if (status.kind === 'done')
    return (
      <span className="st done">
        <Icon name="check" />
        Done
      </span>
    )
  if (status.kind === 'queued')
    return (
      <span className="st q">
        <Icon name="clock" />
        Queued
      </span>
    )
  if (status.kind === 'canceled')
    return (
      <span className="st canceled">
        <Icon name="close" />
        Canceled
      </span>
    )
  return null
}

export function StatusCell({
  status,
  action,
  onAction
}: {
  status: StatusView
  action: RowActionView
  onAction: (k: RowActionKind) => void
}): JSX.Element {
  return (
    <div className="td" role="gridcell">
      <StatusBadge status={status} />
      <RowAction
        icon={action.icon}
        label={action.label}
        ghost={action.ghost}
        onClick={(e) => {
          e.stopPropagation()
          onAction(action.kind)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
