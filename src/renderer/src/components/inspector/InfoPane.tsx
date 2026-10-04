import type { JSX } from 'react'
import type { QueueItem } from '../../state'
import { SmallButton } from '../ui/Button'
import { infoRows } from './infoModel'

export function InfoPane({
  item,
  dims,
  target
}: {
  item: QueueItem
  dims: { width: number; height: number } | null
  target: string | null
}): JSX.Element {
  return (
    <dl className="dgrid">
      {infoRows(item, dims, target).map((r) => (
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
