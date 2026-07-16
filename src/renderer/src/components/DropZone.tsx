import type { JSX } from 'react'
import { Icon } from './Icon'

export function DropZone({
  dragging,
  onBrowse
}: {
  dragging: boolean
  onBrowse: () => void
}): JSX.Element {
  return (
    <button
      onClick={onBrowse}
      className={`no-drag flex min-h-[212px] shrink-0 flex-col items-center justify-center gap-3 rounded-[18px] border-[1.5px] text-center transition ${
        dragging
          ? 'border-accent bg-accent-soft'
          : 'border-[#d8d8e2] bg-white/60 hover:border-accent hover:bg-accent-soft'
      }`}
    >
      <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-gradient-to-br from-accent-soft to-[#e3e3fb] shadow-[inset_0_0_0_1px_rgba(91,91,214,.15)]">
        <Icon name="upload" className="h-[30px] w-[30px] text-accent" strokeWidth={1.8} />
      </span>
      <div>
        <div className="text-[21px] font-bold">Drop files here</div>
        <div className="mt-0.5 text-sm text-muted">
          or <span className="font-semibold text-accent">browse your files</span>: images, video,
          audio, PDFs
        </div>
      </div>
    </button>
  )
}
