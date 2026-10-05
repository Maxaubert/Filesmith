import type { KeyboardEvent, MouseEvent } from 'react'
import type { QueueItem } from '../../state'
import type { RowView } from './rowModel'

/** What every row renderer (Details row, tile, card) gets from QueueTable, so
 * selection, the menu, open and keyboard behave the same in every size. */
export interface RowProps {
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
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}
