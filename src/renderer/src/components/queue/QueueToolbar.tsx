import type { JSX } from 'react'
import { AddFilesButton, IconButton } from '../ui/Button'

export function QueueToolbar({
  files,
  selected,
  dropping,
  canRemove,
  canClear,
  onAdd,
  onRemove,
  onClear
}: {
  files: number
  selected: number
  dropping: boolean
  canRemove: boolean
  canClear: boolean
  onAdd: () => void
  onRemove: () => void
  onClear: () => void
}): JSX.Element {
  const count = dropping
    ? 'Drop to add'
    : `${files} file${files === 1 ? '' : 's'}${selected ? `, ${selected} selected` : ''}`
  return (
    <div className="toolbar" role="toolbar" aria-label="File actions">
      <AddFilesButton onClick={onAdd} title="Add files (Ctrl+O)" />
      <IconButton icon="cleardone" label="Clear finished" disabled={!canClear} onClick={onClear} />
      <IconButton icon="trash" label="Remove selected" disabled={!canRemove} onClick={onRemove} />
      <div className="tb-right">
        <span className="count" aria-live="polite">
          {count}
        </span>
      </div>
    </div>
  )
}
