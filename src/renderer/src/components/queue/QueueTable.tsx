import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../icons/Icon'
import { groupOf, type QueueItem } from '../../state'
import { EmptyState } from './EmptyState'
import { QueueCard } from './QueueCard'
import { QueueRow } from './QueueRow'
import { QueueTile } from './QueueTile'
import { TotalsRow } from './TotalsRow'
import { gridNeighbor, moveFor } from './gridKeys'
import { rowView, type RowActionKind, type Totals } from './rowModel'
import type { RowProps } from './rowProps'
import type { CheckState } from './selectAll'
import { tableKey } from './tableKeys'
import { visibleOrder, type RowGroup, type SortKey, type SortState } from './tableSort'
import { thumbPx, type ViewSize } from './viewSize'

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
  size,
  thumbs,
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
  size: ViewSize
  /** 256px thumbnails by source path, for the two largest sizes. */
  thumbs: Record<string, string | null>
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
  const section = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const order = visibleOrder(groups)
  const lists = groups.map((g) => g.items.map((i) => i.id))
  const [focusId, setFocusId] = useState<string | null>(null)
  const tabStop = focusId && order.includes(focusId) ? focusId : (selected[0] ?? order[0] ?? null)

  // A size change replaces every row element, so focus would fall to <body>:
  // put it back on the same item and keep that item in view (spec 4).
  const prevSize = useRef(size)
  useEffect(() => {
    if (prevSize.current === size) return
    prevSize.current = size
    const el = body.current
    if (!el) return
    const row = tabStop ? el.querySelector<HTMLElement>(`[data-id="${CSS.escape(tabStop)}"]`) : null
    if (document.activeElement === document.body) row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }, [size, tabStop])

  /** Columns of the rendered grid: 1 for Details, 2 for Tiles, auto-fill for icons. */
  function columns(): number {
    if (size === 'details') return 1
    const grid = body.current?.querySelector<HTMLElement>('.tiles, .icons')
    if (!grid) return 1
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  }

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
    const move = moveFor(k)
    if (move) {
      const next = gridNeighbor(lists, id, move.dir, columns())
      if (next) {
        focusRow(next)
        if (move.extend) onExtend(next)
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

  function rowProps(item: QueueItem): RowProps {
    return {
      item,
      view: rowView(item, estimates[item.id]),
      selected: selected.includes(item.id),
      dim: activeGroup != null && groupOf(item.file) !== activeGroup,
      focusable: item.id === tabStop,
      onClick: (e) => {
        setFocusId(item.id)
        onRowClick(item.id, e)
      },
      onToggle: () => onToggleRow(item.id),
      onOpen: () => onOpen(item.id),
      onMenu: (x, y) => onMenu(item.id, x, y),
      onKeyDown: (e) => onRowKey(item.id, e)
    }
  }

  const big = thumbPx(size) > 128
  const thumbOf = (item: QueueItem): string | null =>
    (big ? thumbs[item.file.path] : undefined) ?? item.thumb

  function renderGroup(g: RowGroup): JSX.Element | JSX.Element[] {
    if (size === 'details')
      return g.items.map((item) => (
        <QueueRow key={item.id} {...rowProps(item)} onAction={(k) => onAction(item.id, k)} />
      ))
    if (size === 'tiles')
      return (
        <div className="tiles">
          {g.items.map((item) => (
            <QueueTile key={item.id} {...rowProps(item)} thumb={thumbOf(item)} />
          ))}
        </div>
      )
    return (
      <div className={`icons ${size}${selected.length ? ' any' : ''}`}>
        {g.items.map((item) => (
          <QueueCard key={item.id} {...rowProps(item)} thumb={thumbOf(item)} size={size} />
        ))}
      </div>
    )
  }

  return (
    <section
      ref={section}
      className="qtable"
      data-size={size}
      role="grid"
      aria-label="Files"
      aria-multiselectable="true"
    >
      {size === 'details' && (
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
      )}
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
              {renderGroup(g)}
            </Fragment>
          ))
        )}
      </div>
      {totals.files > 0 && <TotalsRow totals={totals} flat={size !== 'details'} />}
    </section>
  )
}
