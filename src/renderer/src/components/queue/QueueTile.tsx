import type { JSX } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { ResultText } from './ResultCell'
import type { RowProps } from './rowProps'
import { StatusBadge } from './StatusCell'
import { Thumb } from './Thumb'

const DIM = 'A different file type than the current selection'

/** Tiles: a two-line card with a 48px thumb (mockup size 1). */
export function QueueTile({ thumb, ...p }: RowProps & { thumb: string | null }): JSX.Element {
  const { item, view } = p
  return (
    <div
      role="row"
      aria-selected={p.selected}
      tabIndex={p.focusable ? 0 : -1}
      data-id={item.id}
      className={`tile${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`}
      title={p.dim ? DIM : undefined}
      onClick={p.onClick}
      onDoubleClick={p.onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={p.onKeyDown}
    >
      <span className="tck" role="gridcell">
        <Checkbox checked={p.selected} onChange={p.onToggle} label={`Select ${item.file.name}`} />
      </span>
      <Thumb src={thumb} kind={view.kind} fileKind={item.file.kind} big={false} />
      <div className="lines" role="gridcell">
        <div className="l1">
          <span className="name" title={item.file.name}>
            {item.file.name}
          </span>
          <span className="meta">{view.kind}</span>
        </div>
        <div className="l2">
          {view.status.kind === 'failed' ? (
            <StatusBadge status={view.status} />
          ) : (
            <>
              <span className="size">{view.size}</span>
              {view.result && <ResultText result={view.result} split={false} />}
              <StatusBadge status={view.status} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
