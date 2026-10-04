import type { JSX } from 'react'
import type { QueueItem } from '../../state'
import { SmallButton } from '../ui/Button'
import { infoRows, type InfoRow } from './infoModel'

/** The k/v grid itself, shared by queue files and generated images. */
export function InfoGrid({ rows }: { rows: InfoRow[] }): JSX.Element {
  return (
    <dl className="dgrid">
      {rows.map((r) => (
        <div key={r.k}>
          <dt>{r.k}</dt>
          <dd className={r.selectable || r.reveal ? 'select-text' : undefined}>
            <span>{r.v}</span>
            {r.reveal && (
              <SmallButton
                icon="folder"
                onClick={() => window.filesmith.reveal(r.reveal as string)}
              >
                Show
              </SmallButton>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function InfoPane({
  item,
  dims,
  target
}: {
  item: QueueItem
  dims: { width: number; height: number } | null
  target: string | null
}): JSX.Element {
  return <InfoGrid rows={infoRows(item, dims, target)} />
}
