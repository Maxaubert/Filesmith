import type { JSX } from 'react'
import { Icon } from './Icon'

export function DropZone({
  dragging,
  label = 'Drop files here',
  grow = false,
  onBrowse
}: {
  dragging: boolean
  /** Names the type this workspace accepts, e.g. "Drop images here". */
  label?: string
  /** Fill the available height instead of the compact fixed size. Used when the
   * queue is empty, so the whole workspace is one big target. */
  grow?: boolean
  onBrowse: () => void
}): JSX.Element {
  return (
    <button
      onClick={onBrowse}
      className={`no-drag flex flex-col items-center justify-center gap-3 rounded-[18px] border-[1.5px] text-center transition ${
        grow ? 'min-h-0 flex-1' : 'min-h-[212px] shrink-0'
      } ${
        dragging
          ? 'border-accent bg-accent-soft'
          : 'border-[#d8d8e2] bg-white/60 hover:border-accent hover:bg-accent-soft'
      }`}
    >
      <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-gradient-to-br from-accent-soft to-[#e3e3fb] shadow-[inset_0_0_0_1px_rgba(91,91,214,.15)]">
        <Icon name="upload" className="h-[30px] w-[30px] text-accent" strokeWidth={1.8} />
      </span>
      <div>
        <div className="text-[21px] font-bold">{label}</div>
        <div className="mt-0.5 text-sm text-muted">
          or <span className="font-semibold text-accent">browse</span>
        </div>
      </div>
    </button>
  )
}
