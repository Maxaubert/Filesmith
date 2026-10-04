import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import type { ResultView } from './rowModel'

/** The arrow sits centred on the size|result column boundary, on a patch of the
 * row background, and only when the cell has content (spec 4.3). */
export function ResultCell({ result }: { result: ResultView | null }): JSX.Element {
  return (
    <div className="td rc" role="gridcell">
      {result && (
        <span className="res">
          <Icon name="arrow" size={12} className="arr split" />
          {result.estimate ? <span className="est">{result.text}</span> : <b>{result.text}</b>}
          {result.pct && (
            <span
              className={`pct${result.grew ? ' grew' : ''}`}
              title={result.grew ? 'Larger than the original' : undefined}
            >
              {result.pct}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
