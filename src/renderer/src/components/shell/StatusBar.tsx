import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { ProgressBar } from '../ui/ProgressBar'
import type { StatusSummary } from './statusModel'

export function StatusBar({
  summary,
  onFailedClick
}: {
  summary: StatusSummary
  onFailedClick: () => void
}): JSX.Element {
  return (
    <footer className="statusbar" aria-label="Status">
      {summary.running && (
        <div className="sitem" role="status">
          <Icon name="sync" />
          <span>{summary.running.label}</span>
          <ProgressBar value={summary.running.pct} label={summary.running.label} />
        </div>
      )}
      {summary.message && (
        <div className="sitem" role="status">
          <Icon name="sync" />
          <span>{summary.message}</span>
          <ProgressBar value={null} label={summary.message} />
        </div>
      )}
      {summary.done && <div className="sitem">{summary.done}</div>}
      <div className="sright">
        {summary.failed > 0 && (
          <button
            type="button"
            className="sitem warn"
            onClick={onFailedClick}
            title="Select the failed files"
          >
            <Icon name="warning" />
            {summary.failed} failed
          </button>
        )}
      </div>
    </footer>
  )
}
