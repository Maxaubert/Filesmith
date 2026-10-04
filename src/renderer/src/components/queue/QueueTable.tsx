import { Fragment, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../icons/Icon'
import { groupOf } from '../../state'
import { EmptyState } from './EmptyState'
import { QueueRow } from './QueueRow'
import { TotalsRow } from './TotalsRow'
import { rowView, type RowActionKind, type Totals } from './rowModel'
import type { CheckState } from './selectAll'
import { tableKey } from './tableKeys'
import { visibleOrder, type RowGroup, type SortKey, type SortState } from './tableSort'

const HEADS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'name' },
  { key: 'kind', label: 'kind' },
  { key: 'size', label: 'size', num: true },
  { key: 'result', label: 'result' },
  { key: 'status', label: 'status' }
]

export function QueueTable({
  groups,
  totals,
  selected,
  activeGroup,
  sort,
  check,
  estimates,
  onSort,
  onToggleAll,
  onSelectAll,
  onRowClick,
  onToggleRow,
  onExtend,
  onOpen,
  onMenu,
  onAction,
  onRemove,
  onSelectGroup,
  onAdd
}: {
  groups: RowGroup[]
  totals: Totals
  selected: string[]
  activeGroup: string | null
  sort: SortState | null
  check: CheckState
  estimates: Record<string, number | null>
  onSort: (k: SortKey) => void
  onToggleAll: () => void
  onSelectAll: () => void
  onRowClick: (id: string, e: MouseEvent) => void
  onToggleRow: (id: string) => void
  /** Shift+Arrow: extend the range to this id. */
  onExtend: (id: string) => void
  onOpen: (id: string) => void
  onMenu: (id: string, x: number, y: number) => void
  onAction: (id: string, k: RowActionKind) => void
  onRemove: (id: string) => void
  onSelectGroup: (group: string) => void
  onAdd: () => void
}): JSX.Element {
  const body = useRef<HTMLDivElement>(null)
  const order = visibleOrder(groups)
  const [focusId, setFocusId] = useState<string | null>(null)
  const tabStop = focusId && order.includes(focusId) ? focusId : (selected[0] ?? order[0] ?? null)

  function focusRow(id: string | undefined): void {
    if (!id) return
    setFocusId(id)
    body.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus()
  }

  function onRowKey(id: string, e: KeyboardEvent<HTMLDivElement>): void {
    if (e.target !== e.currentTarget) return
    const k = tableKey(e)
    if (!k) return
    e.preventDefault()
    const i = order.indexOf(id)
    if (k === 'up' || k === 'down') focusRow(order[k === 'up' ? i - 1 : i + 1])
    else if (k === 'extendUp' || k === 'extendDown') {
      const next = order[k === 'extendUp' ? i - 1 : i + 1]
      if (next) {
        focusRow(next)
        onExtend(next)
      }
    } else if (k === 'toggle') onToggleRow(id)
    else if (k === 'selectAll') onSelectAll()
    else if (k === 'remove') onRemove(id)
    else if (k === 'open') onOpen(id)
    else {
      const r = e.currentTarget.getBoundingClientRect()
      onMenu(id, r.left + 40, r.bottom)
    }
  }

  return (
    <section className="qtable" role="grid" aria-label="Files" aria-multiselectable="true">
      <div className="thead cols" role="row">
        <div className="th ck" role="columnheader">
          <Checkbox
            checked={check === 'all' ? true : check === 'mixed' ? 'mixed' : false}
            onChange={onToggleAll}
            label="Select all in this group"
            focusable
          />
        </div>
        {HEADS.map((h) => {
          const on = sort?.key === h.key
          const desc = on && sort.dir === 'desc'
          return (
            <div
              key={h.key}
              role="columnheader"
              tabIndex={0}
              aria-sort={on ? (desc ? 'descending' : 'ascending') : 'none'}
              className={`th${h.num ? ' num' : ''}${on ? ' sorted' : ''}${desc ? ' desc' : ''}`}
              onClick={() => onSort(h.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSort(h.key)
                }
              }}
            >
              {h.label}
              <Icon name="chev-d" size={12} className="chev" />
            </div>
          )
        })}
      </div>
      <div ref={body} className="qbody scroll-thin" role="rowgroup">
        {groups.length === 0 ? (
          <EmptyState
            icon="addfile"
            title="No files yet"
            line="Add files or drop them anywhere in the window"
            action={{ label: 'Add files', onClick: onAdd }}
          />
        ) : (
          groups.map((g) => (
            <Fragment key={g.group}>
              {groups.length > 1 && (
                <div className="grp-row" role="row">
                  <button
                    type="button"
                    className="grp"
                    role="gridcell"
                    onClick={() => onSelectGroup(g.group)}
                    title={`Select all ${g.label.toLowerCase()}`}
                  >
                    {g.label.toUpperCase()}
                    <span className="n">{g.items.length}</span>
                  </button>
                </div>
              )}
              {g.items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  view={rowView(item, estimates[item.id])}
                  selected={selected.includes(item.id)}
                  dim={activeGroup != null && groupOf(item.file) !== activeGroup}
                  focusable={item.id === tabStop}
                  onClick={(e) => {
                    setFocusId(item.id)
                    onRowClick(item.id, e)
                  }}
                  onToggle={() => onToggleRow(item.id)}
                  onOpen={() => onOpen(item.id)}
                  onMenu={(x, y) => onMenu(item.id, x, y)}
                  onAction={(k) => onAction(item.id, k)}
                  onKeyDown={(e) => onRowKey(item.id, e)}
                />
              ))}
            </Fragment>
          ))
        )}
      </div>
      <TotalsRow totals={totals} />
    </section>
  )
}
