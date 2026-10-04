import type { JSX, KeyboardEvent, MouseEvent } from 'react'
import type { QueueItem } from '../../state'
import { Checkbox } from '../ui/Checkbox'
import { ResultCell } from './ResultCell'
import { StatusCell } from './StatusCell'
import type { RowActionKind, RowView } from './rowModel'

export function QueueRow({
  item,
  view,
  selected,
  dim,
  focusable,
  onClick,
  onToggle,
  onOpen,
  onMenu,
  onAction,
  onKeyDown
}: {
  item: QueueItem
  view: RowView
  selected: boolean
  /** A row of a different convert group than the selection (spec 2.6). */
  dim: boolean
  focusable: boolean
  onClick: (e: MouseEvent) => void
  onToggle: () => void
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  onAction: (k: RowActionKind) => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}): JSX.Element {
  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-id={item.id}
      className={`tr cols${selected ? ' sel' : ''}${dim ? ' dim' : ''}`}
      title={dim ? 'A different file type than the current selection' : undefined}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={onKeyDown}
    >
      <div className="td ck" role="gridcell">
        <Checkbox checked={selected} onChange={onToggle} label={`Select ${item.file.name}`} />
      </div>
      <div className="td" role="gridcell">
        {item.thumb ? (
          <img className="thumb" src={item.thumb} alt="" />
        ) : (
          <span className="thumb" aria-hidden="true">
            {view.kind.slice(0, 3)}
          </span>
        )}
        <span className="name" title={item.file.name}>
          {item.file.name}
        </span>
        {/* Below 1180px the kind column folds into the name cell (spec 3.7). */}
        <span className="meta ktag" aria-hidden="true">
          {view.kind}
        </span>
      </div>
      <div className="td" role="gridcell">
        <span className="meta">{view.kind}</span>
      </div>
      <div className="td num" role="gridcell">
        <span className="size">{view.size}</span>
      </div>
      <ResultCell result={view.result} />
      <StatusCell status={view.status} action={view.action} onAction={onAction} />
    </div>
  )
}
