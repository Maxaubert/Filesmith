import type { JSX } from 'react'
import { Icon } from '../icons/Icon'

/** The bottom strip of the centre column: only the Console toggle. It stays at
 *  the window bottom; the open panel sits above it. */
export function ConsoleStrip({
  open,
  live,
  onToggle
}: {
  open: boolean
  /** The console run's percentage while the panel is closed, else null. */
  live: string | null
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="constrip" role="toolbar" aria-label="Console strip">
      <button
        type="button"
        className="conbtn"
        aria-pressed={open}
        aria-controls="console"
        title="Console (Ctrl+`)"
        onClick={onToggle}
      >
        <Icon name="console" />
        <span className="cl">Console</span>
        {live && !open && <span className="live">{live}</span>}
        <span className="k">Ctrl+`</span>
      </button>
    </div>
  )
}
