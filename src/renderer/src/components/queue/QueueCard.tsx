import type { JSX } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../icons/Icon'
import { cardLine } from './cardModel'
import type { RowProps } from './rowProps'
import { Thumb } from './Thumb'
import type { ViewSize } from './viewSize'

const DIM = 'A different file type than the current selection'

/** Medium / Large / Extra large icons: square thumb, name, compact status. */
export function QueueCard({
  thumb,
  size,
  ...p
}: RowProps & { thumb: string | null; size: ViewSize }): JSX.Element {
  const { item, view } = p
  const line = cardLine(view, size)
  return (
    <div
      role="row"
      aria-selected={p.selected}
      tabIndex={p.focusable ? 0 : -1}
      data-id={item.id}
      className={`card${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`}
      title={p.dim ? DIM : item.file.name}
      onClick={p.onClick}
      onDoubleClick={p.onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={p.onKeyDown}
    >
      <span className="cck" role="gridcell">
        <Checkbox checked={p.selected} onChange={p.onToggle} label={`Select ${item.file.name}`} />
      </span>
      <Thumb src={thumb} kind={view.kind} fileKind={item.file.kind} big />
      <div className="cname" role="gridcell">
        {item.file.name}
      </div>
      <div className={`cst ${line.kind}`} role="gridcell" title={line.title}>
        {line.icon && <Icon name={line.icon} size={12} />}
        {line.kind === 'running' ? (
          <span className="prog">
            <b>{line.strong}</b>
            <span className="eta">{line.eta}</span>
          </span>
        ) : (
          line.strong && <b>{line.strong}</b>
        )}
        {line.text && <span className="ct">{line.text}</span>}
        {line.pct && <span className="pct">{line.pct}</span>}
        {line.extra && <span className="xtra">{line.extra}</span>}
      </div>
    </div>
  )
}
