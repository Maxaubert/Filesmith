import type { JSX } from 'react'
import { formatBytes } from '@shared/compress'
import { Icon } from '../icons/Icon'
import type { Totals } from './rowModel'

export function TotalsRow({ totals: t }: { totals: Totals }): JSX.Element {
  return (
    <div className="totals cols" role="row" aria-label="Totals">
      <div className="td" role="gridcell" />
      <div className="td" role="gridcell">
        {t.files} file{t.files === 1 ? '' : 's'}
      </div>
      <div className="td" role="gridcell" />
      <div className="td num" role="gridcell">
        {formatBytes(t.bytes)}
      </div>
      <div className="td" role="gridcell">
        {t.doneSrc > 0 && (
          <>
            <span>{formatBytes(t.doneSrc)}</span>
            <Icon name="arrow" size={12} className="tarr" />
            <b>{formatBytes(t.doneOut)}</b>
            <span className="pct">so far</span>
          </>
        )}
      </div>
      <div className="td" role="gridcell">
        {t.files > 0 && (
          <b>
            {t.done} of {t.files} done
          </b>
        )}
      </div>
    </div>
  )
}
