import type { JSX } from 'react'
import { formatBytes } from '@shared/compress'
import { Icon } from '../icons/Icon'
import type { Totals } from './rowModel'

/** Column-aligned under Details; one flat line under the other sizes. */
export function TotalsRow({
  totals: t,
  flat = false
}: {
  totals: Totals
  flat?: boolean
}): JSX.Element {
  const files = `${t.files} file${t.files === 1 ? '' : 's'}`
  const soFar =
    t.doneSrc > 0 ? (
      <>
        <span>{formatBytes(t.doneSrc)}</span>
        <Icon name="arrow" size={12} className="tarr" />
        <b>{formatBytes(t.doneOut)}</b>
        <span className="pct">so far</span>
      </>
    ) : null
  const done = t.files > 0 && (
    <b>
      {t.done} of {t.files} done
    </b>
  )
  if (flat)
    return (
      <div className="totals flat" role="row" aria-label="Totals">
        <span role="gridcell">
          {files}, {formatBytes(t.bytes)}
        </span>
        {soFar && (
          <span role="gridcell" className="res">
            {soFar}
          </span>
        )}
        <span role="gridcell">{done}</span>
      </div>
    )
  return (
    <div className="totals cols" role="row" aria-label="Totals">
      <div className="td" role="gridcell" />
      <div className="td" role="gridcell">
        {files}
      </div>
      <div className="td" role="gridcell" />
      <div className="td num" role="gridcell">
        {formatBytes(t.bytes)}
      </div>
      <div className="td" role="gridcell">
        {soFar}
      </div>
      <div className="td" role="gridcell">
        {done}
      </div>
    </div>
  )
}
