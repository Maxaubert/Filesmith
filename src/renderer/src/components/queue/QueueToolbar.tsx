import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { AddFilesButton } from '../ui/Button'
import { ViewMenu } from './ViewMenu'
import type { ViewSize } from './viewSize'

/** Add files, the count, the Console toggle and the View menu. Row actions (remove, delete, clear
 * finished) live in the right-click menu on the rows themselves. */
export function QueueToolbar({
  files,
  selected,
  dropping,
  size,
  flash,
  consoleOpen,
  consoleLive,
  onAdd,
  onView,
  onConsole
}: {
  files: number
  selected: number
  dropping: boolean
  size: ViewSize
  flash: boolean
  consoleOpen: boolean
  /** The console run's percentage while the panel is closed, else null. */
  consoleLive: string | null
  onAdd: () => void
  onView: (s: ViewSize) => void
  onConsole: () => void
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
        <button
          type="button"
          className="conbtn"
          aria-pressed={consoleOpen}
          aria-controls="console"
          title="Console (Ctrl+`)"
          onClick={onConsole}
        >
          <Icon name="console" />
          <span className="cl">Console</span>
          {consoleLive && !consoleOpen && <span className="live">{consoleLive}</span>}
          <span className="k">Ctrl+`</span>
        </button>
        <ViewMenu size={size} flash={flash} onPick={onView} />
      </div>
    </div>
  )
}
