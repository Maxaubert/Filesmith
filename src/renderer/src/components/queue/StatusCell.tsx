import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { RowAction } from '../ui/Button'
import type { RowActionKind, RowActionView, StatusView } from './rowModel'

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
      {status.kind === 'failed' ? (
        <span className="st fail" title={status.title}>
          <Icon name="warning" />
          {status.text}
        </span>
      ) : status.kind === 'running' ? (
        <span className="st run">
          <Icon name="sync" />
          <span className="prog">
            <b>{status.pct}</b>
            <span className="eta">{status.eta}</span>
          </span>
        </span>
      ) : status.kind === 'done' ? (
        <span className="st done">
          <Icon name="check" />
          Done
        </span>
      ) : status.kind === 'queued' ? (
        <span className="st q">
          <Icon name="clock" />
          Queued
        </span>
      ) : status.kind === 'canceled' ? (
        <span className="st canceled">
          <Icon name="close" />
          Canceled
        </span>
      ) : null}
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
