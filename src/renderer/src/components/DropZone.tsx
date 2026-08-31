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
        grow ? 'min-h-0 flex-1' : 'min-h-[104px] shrink-0 lg:min-h-[150px]'
      } ${
        dragging
          ? 'border-accent bg-accent-soft'
          : 'border-[#d8d8e2] bg-white/60 hover:border-accent hover:bg-accent-soft'
      }`}
    >
      {/* The icon is the empty state's anchor; once files exist the zone is a
          slim target and the glyph would just eat the queue's room. */}
      <span
        className={`grid place-items-center rounded-[18px] bg-gradient-to-br from-accent-soft to-[#e3e3fb] shadow-[inset_0_0_0_1px_rgba(91,91,214,.15)] ${
          grow ? 'h-16 w-16' : 'hidden h-11 w-11 lg:grid'
        }`}
      >
        <Icon
          name="upload"
          className={grow ? 'h-[30px] w-[30px] text-accent' : 'h-[22px] w-[22px] text-accent'}
          strokeWidth={1.8}
        />
      </span>
      <div>
        <div className={grow ? 'text-[21px] font-bold' : 'text-[16px] font-bold lg:text-[19px]'}>
          {label}
        </div>
        <div className="mt-0.5 text-sm text-muted">
          or <span className="font-semibold text-accent">browse</span>
        </div>
      </div>
    </button>
  )
}
