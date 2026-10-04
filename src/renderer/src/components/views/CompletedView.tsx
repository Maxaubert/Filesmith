import { useState, type JSX, type MouseEvent } from 'react'
import { formatBytes } from '@shared/compress'
import type { QueueItem } from '../../state'
import type { CompletedItem } from '../completed'
import { Icon } from '../icons/Icon'
import { EmptyState } from '../queue/EmptyState'
import { ResultCell } from '../queue/ResultCell'
import { kindLabel, rowView } from '../queue/rowModel'
import { RowAction } from '../ui/Button'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOf = (p: string): string => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}

/** The files table in read-only mode (spec 5.3): name | from | kind | size | result | action. */
export function CompletedView({
  entries,
  thumbs,
  onOpen,
  onReveal,
  onMenu,
  onDelete,
  onClear
}: {
  entries: CompletedItem[]
  thumbs: Record<string, string | null>
  onOpen: (item: QueueItem) => void
  onReveal: (path: string) => void
  onMenu: (item: QueueItem, x: number, y: number, ids: string[]) => void
  onDelete: (ids: string[]) => void
  onClear: (ids: string[]) => void
}): JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const ids = entries.map((e) => e.item.id)
  const selected = picked.filter((id) => ids.includes(id))

  function click(id: string, e: MouseEvent): void {
    if (e.shiftKey && anchor && ids.includes(anchor)) {
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y)
      setPicked(ids.slice(a, b + 1))
      return
    }
    if (e.ctrlKey || e.metaKey)
      setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    else setPicked([id])
    setAnchor(id)
  }

  return (
    <>
      <div className="vhead">
        <h1>Completed</h1>
        <span>
          {entries.length} file{entries.length === 1 ? '' : 's'}
        </span>
        <div className="tb-right">
          <button
            type="button"
            className="tbtn"
            disabled={!selected.length}
            onClick={() => onDelete(selected)}
          >
            <Icon name="trash" />
            Delete selected
          </button>
          <button
            type="button"
            className="tbtn"
            disabled={!entries.length}
            onClick={() => onClear(ids)}
            title="Hides the list; files stay on disk"
          >
            <Icon name="close" />
            Clear list
          </button>
        </div>
      </div>
      <section
        className="qtable done-table"
        role="grid"
        aria-label="Completed"
        aria-multiselectable="true"
      >
        <div className="thead ccols" role="row">
          {['name', 'from', 'kind', 'size', 'result', ''].map((h, i) => (
            <div key={i} className={`th${h === 'size' ? ' num' : ''}`} role="columnheader">
              {h}
            </div>
          ))}
        </div>
        <div className="qbody scroll-thin" role="rowgroup">
          {entries.length === 0 ? (
            <EmptyState
              icon="completed"
              title="Nothing finished yet"
              line="Files you convert, compress or resize land here"
            />
          ) : (
            entries.map(({ item, from }) => {
              const out = item.outputPath as string
              const thumb = thumbs[out] ?? null
              const sel = selected.includes(item.id)
              return (
                <div
                  key={item.id}
                  role="row"
                  aria-selected={sel}
                  tabIndex={-1}
                  className={`tr ccols${sel ? ' sel' : ''}`}
                  onClick={(e) => click(item.id, e)}
                  onDoubleClick={() => onOpen(item)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onMenu(item, e.clientX, e.clientY, sel ? selected : [item.id])
                  }}
                >
                  <div className="td" role="gridcell">
                    {thumb ? (
                      <img className="thumb" src={thumb} alt="" />
                    ) : (
                      <span className="thumb">{kindLabel(extOf(out)).slice(0, 3)}</span>
                    )}
                    <span className="name" title={out}>
                      {baseName(out)}
                    </span>
                  </div>
                  <div className="td" role="gridcell">
                    <span className="meta">{from.toLowerCase()}</span>
                  </div>
                  <div className="td" role="gridcell">
                    <span className="meta">{kindLabel(extOf(out))}</span>
                  </div>
                  <div className="td num" role="gridcell">
                    <span className="size">{formatBytes(item.file.size)}</span>
                  </div>
                  <ResultCell result={rowView(item).result} />
                  <div className="td" role="gridcell">
                    <RowAction
                      icon="folder"
                      label="Show in folder"
                      ghost
                      onClick={(e) => {
                        e.stopPropagation()
                        onReveal(out)
                      }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </>
  )
}
