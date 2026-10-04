import { groupOf, inInput, type ItemStatus, type QueueItem } from '../../state'
import { groupLabel, groupRank } from '../queueGroups'

export type SortKey = 'name' | 'kind' | 'size' | 'result' | 'status'
export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

/** Header click cycle: ascending, descending, back to insertion order. */
export function nextSort(cur: SortState | null, key: SortKey): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: 'asc' }
  return cur.dir === 'asc' ? { key, dir: 'desc' } : null
}

const STATUS_RANK: Record<ItemStatus, number> = {
  failed: 0,
  running: 1,
  queued: 2,
  ready: 3,
  canceled: 4,
  done: 5
}

function compare(a: QueueItem, b: QueueItem, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.file.name.localeCompare(b.file.name, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    case 'kind':
      return a.file.ext.localeCompare(b.file.ext)
    case 'size':
      return a.file.size - b.file.size
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    case 'result':
      return (a.outputSize ?? 0) - (b.outputSize ?? 0)
  }
}

export function sortItems(items: QueueItem[], sort: SortState | null): QueueItem[] {
  if (!sort) return items.slice()
  const sign = sort.dir === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      if (sort.key === 'result') {
        // Rows without a result always go last, whichever the direction.
        const ex = x.item.outputSize == null
        const ey = y.item.outputSize == null
        if (ex !== ey) return ex ? 1 : -1
      }
      return sign * compare(x.item, y.item, sort.key) || x.index - y.index
    })
    .map((x) => x.item)
}

export interface RowGroup {
  group: string
  label: string
  items: QueueItem[]
}

/** Input rows bucketed by convert group in display order, each bucket sorted. */
export function groupedRows(items: QueueItem[], sort: SortState | null): RowGroup[] {
  const by = new Map<string, QueueItem[]>()
  for (const i of items) {
    if (!inInput(i)) continue
    const g = groupOf(i.file)
    const list = by.get(g)
    if (list) list.push(i)
    else by.set(g, [i])
  }
  return [...by.keys()]
    .sort((a, b) => groupRank(a) - groupRank(b))
    .map((g) => ({ group: g, label: groupLabel(g), items: sortItems(by.get(g)!, sort) }))
}

export function visibleOrder(groups: RowGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.id))
}
