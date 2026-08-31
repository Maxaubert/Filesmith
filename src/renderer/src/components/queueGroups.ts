import { groupOf, type QueueItem } from '../state'

// Queue grouping lives apart from Queue.tsx so that file exports only
// components (React Fast Refresh requires that), matching how the status hooks
// are split out.

/** Display order for the group headers: the everyday kinds first, then the
 * document family, then the long tail. */
const GROUP_ORDER = ['image', 'video', 'audio', 'doc', 'sheet', 'slide', 'archive']
const GROUP_NOUN: Record<string, (n: number) => string> = {
  image: (n) => `${n} image${n === 1 ? '' : 's'}`,
  video: (n) => `${n} video${n === 1 ? '' : 's'}`,
  audio: (n) => `${n} audio file${n === 1 ? '' : 's'}`,
  doc: (n) => `${n} document${n === 1 ? '' : 's'}`,
  sheet: (n) => `${n} spreadsheet${n === 1 ? '' : 's'}`,
  slide: (n) => `${n} slide deck${n === 1 ? '' : 's'}`,
  archive: (n) => `${n} archive${n === 1 ? '' : 's'}`
}
const GROUP_LABEL: Record<string, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  doc: 'Documents',
  sheet: 'Spreadsheets',
  slide: 'Slides',
  archive: 'Archives'
}

/** The dot colour beside a group's name in the options panel. */
export const GROUP_COLOR: Record<string, string> = {
  image: '#5b5bd6',
  video: '#e0483d',
  audio: '#f5920b',
  doc: '#12b3a6',
  sheet: '#12b3a6',
  slide: '#12b3a6',
  archive: '#a16207'
}

/** "2 images" / "1 document" / "3 archives". Named by CONVERT GROUP, not file
 * kind: a pdf plus a txt is "2 documents", because they run as one batch and
 * the options panel describes them as one. */
export function groupNoun(group: string, n: number): string {
  const f = GROUP_NOUN[group]
  return f ? f(n) : `${n} file${n === 1 ? '' : 's'}`
}

export interface ItemGroup {
  group: string
  label: string
  count: string
  items: QueueItem[]
}

/**
 * Split a queue into convert groups for the Input column's headers. Returns
 * null for zero or one group, so the ordinary single-kind queue renders exactly
 * as it always has and the headers only appear when they are actually telling
 * the user something.
 */
export function groupItemsByGroup(items: QueueItem[]): ItemGroup[] | null {
  const byGroup = new Map<string, QueueItem[]>()
  for (const i of items) {
    const g = groupOf(i.file)
    const cur = byGroup.get(g)
    if (cur) cur.push(i)
    else byGroup.set(g, [i])
  }
  if (byGroup.size < 2) return null
  const order = [...byGroup.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    return (ia < 0 ? GROUP_ORDER.length : ia) - (ib < 0 ? GROUP_ORDER.length : ib)
  })
  return order.map((g) => {
    const list = byGroup.get(g)!
    return {
      group: g,
      label: GROUP_LABEL[g] ?? 'Other',
      count: (GROUP_NOUN[g] ?? ((n: number) => `${n} file${n === 1 ? '' : 's'}`))(list.length),
      items: list
    }
  })
}
