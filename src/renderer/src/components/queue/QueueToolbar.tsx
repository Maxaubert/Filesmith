import type { JSX } from 'react'
import { AddFilesButton, IconButton } from '../ui/Button'

export function QueueToolbar({
  files,
  selected,
  dropping,
  canRemove,
  canRetry,
  canClear,
  canStop,
  onAdd,
  onRemove,
  onRetry,
  onClear,
  onStop
}: {
  files: number
  selected: number
  dropping: boolean
  canRemove: boolean
  canRetry: boolean
  canClear: boolean
  canStop: boolean
  onAdd: () => void
  onRemove: () => void
  onRetry: () => void
  onClear: () => void
  onStop: () => void
}): JSX.Element {
  const count = dropping
    ? 'Drop to add'
    : `${files} file${files === 1 ? '' : 's'}${selected ? `, ${selected} selected` : ''}`
  return (
    <div className="toolbar" role="toolbar" aria-label="File actions">
      <AddFilesButton onClick={onAdd} title="Add files (Ctrl+O)" />
      <IconButton icon="close" label="Remove selected" disabled={!canRemove} onClick={onRemove} />
      <IconButton icon="retry" label="Retry failed" disabled={!canRetry} onClick={onRetry} />
      <IconButton icon="trash" label="Clear finished" disabled={!canClear} onClick={onClear} />
      <div className="tb-right">
        <span className="count" aria-live="polite">
          {count}
        </span>
        <IconButton icon="stop" label="Stop all" disabled={!canStop} onClick={onStop} />
      </div>
    </div>
  )
}
