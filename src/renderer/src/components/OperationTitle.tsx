import type { JSX } from 'react'
import { Icon } from './Icon'

/**
 * The page heading: the verb ("Convert", "Compress"), or the open tool's name
 * inside Tools, plus a file count once files exist.
 *
 * The rail already names the verb, so this heading repeats it back as the
 * workspace's own title. Inside a Tools workspace it also carries the way back
 * to the grid, which is the only place in the app with a second level.
 */
export function OperationTitle({
  title,
  desc,
  color,
  fileCount,
  onBack
}: {
  title: string
  desc: string
  color: string
  fileCount: number
  /** Present only inside a Tools workspace. */
  onBack?: () => void
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        {onBack && (
          <button
            onClick={onBack}
            title="Back to Tools"
            aria-label="Back to Tools"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-black/[.05] hover:text-ink"
          >
            <Icon name="chevron-left" className="h-4 w-4" />
          </button>
        )}
        <h1 className="text-[26px] font-bold tracking-tight" style={{ color }}>
          {title}
        </h1>
      </div>
      {/* The line always occupies its height so nothing below it shifts when a
          file is added and the count appears. Falls back to the verb's own
          one-liner while the queue is empty. */}
      <p className="mt-0.5 h-[18px] text-[13px] text-muted">
        {fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : desc}
      </p>
    </div>
  )
}
