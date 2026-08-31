import type { JSX, MouseEvent } from 'react'
import { formatBytes, type QueueItem } from '../state'
import type { CompletedItem } from './completed'
import { baseName } from '@shared/fileKind'
import { Icon } from './Icon'

const extOf = (n: string): string => {
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i + 1).toUpperCase() : ''
}

function Row({
  entry,
  thumb,
  onOpen,
  onMenu
}: {
  entry: CompletedItem
  thumb: string | null
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}): JSX.Element {
  const { item, from } = entry
  const out = item.outputPath as string
  return (
    <div
      onDoubleClick={onOpen}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-black/[.07] bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,.05),0_8px_22px_rgba(20,20,40,.05)] transition hover:border-black/[.14]"
    >
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[9px] bg-[#ececf1] shadow-[inset_0_0_0_1px_rgba(0,0,0,.05)]">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[9px] font-semibold uppercase text-dim">
            {extOf(out)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{baseName(out)}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-dim">
          {from}
          <span className="mx-1 text-[#c3c3cc]">·</span>
          {extOf(out)}
          {item.outputSize != null && (
            <>
              <span className="mx-1 text-[#c3c3cc]">·</span>
              {formatBytes(item.outputSize)}
              {/* Change vs the source. Green when it shrank; amber when it grew
                  (re-encoding an already-optimised file can do that) - hiding
                  that just makes compression look broken. */}
              {item.file.size > 0 &&
                (item.outputSize < item.file.size ? (
                  <span className="ml-1 font-semibold text-[#12a150]">
                    −{Math.round((1 - item.outputSize / item.file.size) * 100)}%
                  </span>
                ) : (
                  <span
                    className="ml-1 font-semibold text-[#b7791f]"
                    title="Bigger than the original — this file was already well compressed"
                  >
                    +{Math.round((item.outputSize / item.file.size - 1) * 100)}%
                  </span>
                ))}
            </>
          )}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onMenu(r.right, r.bottom + 6)
        }}
        aria-label="More"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-dim opacity-0 transition hover:bg-black/[.05] hover:text-ink group-hover:opacity-100"
      >
        <Icon name="dots" className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Everything the app has produced, in one place. This used to be a second
 * column beside the queue in every workspace, which meant results were split
 * across seven screens and each workspace spent half its width on files the
 * user had already finished with.
 */
export function CompletedView({
  entries,
  thumbs,
  onOpen,
  onMenu
}: {
  entries: CompletedItem[]
  thumbs: Record<string, string | null>
  onOpen: (item: QueueItem) => void
  onMenu: (item: QueueItem, x: number, y: number) => void
}): JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <div className="text-center">
          <div className="text-[15px] font-semibold text-muted">Nothing finished yet</div>
          <p className="mt-1 text-[13px] text-dim">
            Files you convert, compress or resize land here.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="scroll-thin -mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-4">
      {entries.map((e) => (
        <Row
          key={e.item.id}
          entry={e}
          thumb={e.item.outputPath ? (thumbs[e.item.outputPath] ?? null) : null}
          onOpen={() => onOpen(e.item)}
          onMenu={(x, y) => onMenu(e.item, x, y)}
        />
      ))}
    </div>
  )
}
