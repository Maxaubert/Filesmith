import { groupOf, inInput, type QueueItem } from '../../state'
import { groupRank } from '../queueGroups'

export type CheckState = 'none' | 'mixed' | 'all'

/** The group the header checkbox speaks for: the selection's group, or the
 * first group in display order when nothing is selected. */
export function activeGroupFor(items: QueueItem[], selected: string[]): string | null {
  const rows = items.filter(inInput)
  const first = rows.find((i) => i.id === selected[0])
  if (first) return groupOf(first.file)
  const groups = [...new Set(rows.map((i) => groupOf(i.file)))]
  if (!groups.length) return null
  return groups.sort((a, b) => groupRank(a) - groupRank(b))[0]
}

function groupIds(items: QueueItem[], group: string | null): string[] {
  return items.filter((i) => inInput(i) && groupOf(i.file) === group).map((i) => i.id)
}

export function headerCheck(items: QueueItem[], selected: string[]): CheckState {
  const ids = groupIds(items, activeGroupFor(items, selected))
  const n = ids.filter((id) => selected.includes(id)).length
  if (n === 0) return 'none'
  return n === ids.length ? 'all' : 'mixed'
}

/** What a header click selects: the whole active group, or nothing when the
 * group is already fully selected. Never crosses groups. */
export function toggleAllIds(items: QueueItem[], selected: string[]): string[] {
  const ids = groupIds(items, activeGroupFor(items, selected))
  return headerCheck(items, selected) === 'all' ? [] : ids
}

/** Restrict a set of ids to one convert group (the first in display order among
 * them), so bulk selections such as "select the failed rows" never span groups. */
export function oneGroupIds(items: QueueItem[], ids: string[]): string[] {
  const set = new Set(ids)
  const rows = items.filter((i) => inInput(i) && set.has(i.id))
  if (!rows.length) return []
  const group = [...new Set(rows.map((i) => groupOf(i.file)))].sort(
    (a, b) => groupRank(a) - groupRank(b)
  )[0]
  return ids.filter((id) => rows.some((r) => r.id === id && groupOf(r.file) === group))
}
