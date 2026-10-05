import type { TableKey } from './tableKeys'

// Keyboard movement over the files view (spec 4): Details is one column, Tiles
// two, the icon grids as many as fit. `groups` holds each convert group's ids in
// display order; each group starts a new visual row under its header.

export type GridDir = 'up' | 'down' | 'left' | 'right'

const MOVES: Partial<Record<TableKey, { dir: GridDir; extend: boolean }>> = {
  up: { dir: 'up', extend: false },
  down: { dir: 'down', extend: false },
  left: { dir: 'left', extend: false },
  right: { dir: 'right', extend: false },
  extendUp: { dir: 'up', extend: true },
  extendDown: { dir: 'down', extend: true },
  extendLeft: { dir: 'left', extend: true },
  extendRight: { dir: 'right', extend: true }
}

export function moveFor(k: TableKey): { dir: GridDir; extend: boolean } | null {
  return MOVES[k] ?? null
}

export function gridNeighbor(
  groups: string[][],
  id: string,
  dir: GridDir,
  cols: number
): string | undefined {
  const g = groups.findIndex((list) => list.includes(id))
  if (g < 0) return undefined
  const c = Math.max(1, Math.floor(cols))
  if (dir === 'left' || dir === 'right') {
    if (c === 1) return undefined
    const flat = groups.flat()
    return flat[flat.indexOf(id) + (dir === 'left' ? -1 : 1)]
  }
  const list = groups[g]
  const i = list.indexOf(id)
  const col = i % c
  if (dir === 'down') {
    if (i + c < list.length) return list[i + c]
    // A short last row below: land on its last item, like Explorer.
    if (Math.floor(i / c) < Math.floor((list.length - 1) / c)) return list[list.length - 1]
    const next = groups[g + 1]
    return next ? next[Math.min(col, next.length - 1)] : undefined
  }
  if (i - c >= 0) return list[i - c]
  const prev = groups[g - 1]
  if (!prev) return undefined
  const lastRowStart = Math.floor((prev.length - 1) / c) * c
  return prev[Math.min(lastRowStart + col, prev.length - 1)]
}
