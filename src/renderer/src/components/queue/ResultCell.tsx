import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import type { ResultView } from './rowModel'

/** Arrow, result size and change %. `split` centres the arrow on the
 * size|result column boundary (Details only, spec 4.3). */
export function ResultText({ result, split }: { result: ResultView; split: boolean }): JSX.Element {
  return (
    <span className="res">
      <Icon name="arrow" size={12} className={split ? 'arr split' : 'arr'} />
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
  )
}

export function ResultCell({ result }: { result: ResultView | null }): JSX.Element {
  return (
    <div className="td rc" role="gridcell">
      {result && <ResultText result={result} split />}
    </div>
  )
}
