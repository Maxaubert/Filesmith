import type { IconName } from '@shared/icons'
import type { FileKind } from '@shared/types'
import type { ItemStatus } from '../../state'
import type { RowView } from './rowModel'
import type { ViewSize } from './viewSize'

// The compact status line under an icon-grid card (spec 4, table). Larger
// cards add detail: the change %, the estimate, the source size.

export interface CardLine {
  kind: ItemStatus
  icon: IconName | null
  /** Bold lead: the result size, or the running percentage. */
  strong?: string
  /** Plain text: Queued, Canceled, Failed / the short error, or the source size. */
  text?: string
  eta?: string
  pct?: string
  /** Right-aligned fg3 extra: the estimate or the source size. */
  extra?: string
  title?: string
}

export function cardLine(v: RowView, size: ViewSize): CardLine {
  const big = size === 'large' || size === 'xl'
  const src = big ? v.size : undefined
  const s = v.status
  switch (s.kind) {
    case 'done':
      return {
        kind: 'done',
        icon: 'check',
        strong: v.result?.text ?? 'Done',
        pct: big ? (v.result?.pct ?? undefined) : undefined,
        extra: size === 'xl' ? v.size : undefined
      }
    case 'running':
      return {
        kind: 'running',
        icon: 'sync',
        strong: s.pct ?? '…',
        eta: s.eta,
        extra: big ? v.result?.text : undefined
      }
    case 'queued':
      return { kind: 'queued', icon: 'clock', text: 'Queued', extra: src }
    case 'failed':
      return { kind: 'failed', icon: 'warning', text: big ? s.text : 'Failed', title: s.title }
    case 'canceled':
      return { kind: 'canceled', icon: 'close', text: 'Canceled', extra: src }
    default:
      return { kind: 'ready', icon: null, text: v.size }
  }
}

const KIND_ICON: Record<FileKind, IconName> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  document: 'doc',
  text: 'text',
  archive: 'archive',
  other: 'doc'
}

/** The glyph a card shows when there is no thumbnail. */
export function kindIcon(k: FileKind): IconName {
  return KIND_ICON[k]
}
