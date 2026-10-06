import type { JSX } from 'react'
import { Icon } from '../icons/Icon'

/** The bottom strip of the centre column: only the Console toggle. Hidden
 *  while the panel is open; the panel then takes the window bottom. Kept
 *  mounted so focus can return to the toggle on close. */
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
    <div className="constrip" role="toolbar" aria-label="Console strip" hidden={open}>
      <button
        type="button"
        className="conbtn"
        aria-pressed={open}
        aria-controls="console"
        onClick={onToggle}
      >
        <Icon name="console" />
        <span className="cl">Console</span>
        {live && <span className="live">{live}</span>}
        <span className="k">Ctrl+`</span>
      </button>
    </div>
  )
}
