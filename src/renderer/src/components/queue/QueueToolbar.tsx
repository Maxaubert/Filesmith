import type { JSX } from 'react'
import { AddFilesButton } from '../ui/Button'
import { ViewMenu } from './ViewMenu'
import type { ViewSize } from './viewSize'

/** Add files, the count and the View menu (the Console toggle is in the bottom strip). Row actions (remove, delete, clear
 * finished) live in the right-click menu on the rows themselves. */
export function QueueToolbar({
  files,
  selected,
  dropping,
  size,
  flash,
  onAdd,
  onView
}: {
  files: number
  selected: number
  dropping: boolean
  size: ViewSize
  flash: boolean
  onAdd: () => void
  onView: (s: ViewSize) => void
}): JSX.Element {
  const count = dropping
    ? 'Drop to add'
    : `${files} file${files === 1 ? '' : 's'}${selected ? `, ${selected} selected` : ''}`
  return (
    <div className="toolbar" role="toolbar" aria-label="File actions">
      <AddFilesButton onClick={onAdd} title="Add files (Ctrl+O)" />
      <div className="tb-right">
        <span className="count" aria-live="polite">
          {count}
        </span>
        <ViewMenu size={size} flash={flash} onPick={onView} />
      </div>
    </div>
  )
}
