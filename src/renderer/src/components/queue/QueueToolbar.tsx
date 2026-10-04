import type { JSX } from 'react'
import { AddFilesButton } from '../ui/Button'

/** Add files and the count. Row actions (remove, delete, clear finished) live in
 * the right-click menu on the rows themselves. */
export function QueueToolbar({
  files,
  selected,
  dropping,
  onAdd
}: {
  files: number
  selected: number
  dropping: boolean
  onAdd: () => void
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
      </div>
    </div>
  )
}
