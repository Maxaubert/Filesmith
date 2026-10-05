import type { JSX } from 'react'
import type { FileKind } from '@shared/types'
import { Icon } from '../icons/Icon'
import { kindIcon } from './cardModel'

/** A row thumbnail. Small (Details, Tiles): the image or the kind's letters.
 * Big (icon grids): the image or the kind's glyph, and the kind tag. No play
 * glyph: nothing in the grid plays a video, so it would promise an action. */
export function Thumb({
  src,
  kind,
  fileKind,
  big
}: {
  src: string | null
  kind: string
  fileKind: FileKind
  big: boolean
}): JSX.Element {
  if (!big)
    return src ? (
      <img className="thumb" src={src} alt="" />
    ) : (
      <span className="thumb" aria-hidden="true">
        {kind.slice(0, 3)}
      </span>
    )
  return (
    <span className="thumb big" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <Icon name={kindIcon(fileKind)} className="ph" />}
      <span className="kt">{kind}</span>
    </span>
  )
}
