import type { JSX } from 'react'
import type { Category } from '@shared/catalog'

/**
 * The page heading: the file type ("Images", "PDF"), and a file count once files
 * exist.
 *
 * Not the operation. The operation is named by the coloured switcher in the
 * sidebar, so the heading names the other axis (what kind of file you're working
 * with) rather than repeating the mode.
 */
export function OperationTitle({
  category,
  fileCount
}: {
  category: Category
  fileCount: number
}): JSX.Element {
  return (
    <div>
      <h1 className="text-[26px] font-bold tracking-tight">{category.label}</h1>
      {/* The line always occupies its height so nothing below it shifts when a
          file is added and the count appears. Empty until there's a count. */}
      <p className="mt-0.5 h-[18px] text-[13px] text-muted">
        {fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : ''}
      </p>
    </div>
  )
}
