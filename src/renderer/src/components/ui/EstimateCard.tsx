import type { JSX } from 'react'
import { formatBytes } from '@shared/compress'
import { Icon } from '../icons/Icon'
import { formatPct, pctChange } from '../queue/rowModel'

export function EstimateCard({
  from,
  to,
  files
}: {
  from: number
  to: number
  files: number
}): JSX.Element {
  const pct = pctChange(from, to)
  const noun = `${files} file${files === 1 ? '' : 's'}`
  const label = `Estimated output for ${noun}: ${formatBytes(from)} to about ${formatBytes(to)}${
    pct != null ? `, ${formatPct(pct)}` : ''
  }`
  return (
    <div className="vs-est" role="group" aria-label={label}>
      <div className="eh">
        <span>estimate</span>
        <span>{noun}</span>
      </div>
      <div className="ev">
        <span className="from">{formatBytes(from)}</span>
        <Icon name="arrow" size={12} />
        <b>~{formatBytes(to)}</b>
        {pct != null && <span className="pct">{formatPct(pct)}</span>}
      </div>
    </div>
  )
}
