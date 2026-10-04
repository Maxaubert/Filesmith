import type { JSX, ReactNode } from 'react'
import { PrimaryButton } from '../ui/Button'
import { Tabs } from '../ui/Tabs'

export type InspTab = 'options' | 'preview' | 'info'

/** The right column (spec 3.4): tabs, a scrolling body with the head, and a
 * pinned footer holding Run. */
export function Inspector({
  tab,
  onTab,
  title,
  sub,
  runLabel,
  runDisabled,
  onRun,
  stopping = false,
  onStop,
  children
}: {
  tab: InspTab
  onTab: (t: InspTab) => void
  title: string
  sub: string
  runLabel: string
  runDisabled: boolean
  onRun: () => void
  /** While work runs, Run becomes Stop (owner, 2026-10-04). */
  stopping?: boolean
  onStop?: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <aside className="insp" aria-label="Inspector">
      <Tabs
        label="Inspector"
        idPrefix="insp"
        value={tab}
        onChange={onTab}
        tabs={[
          { id: 'options', label: 'Options', icon: 'settings' },
          { id: 'preview', label: 'Preview', icon: 'eye' },
          { id: 'info', label: 'Info', icon: 'info' }
        ]}
      />
      <div
        className="ibody scroll-thin"
        role="tabpanel"
        id={`insp-panel-${tab}`}
        aria-labelledby={`insp-tab-${tab}`}
      >
        <div className="ihead">
          <h1>{title}</h1>
          <span>{sub}</span>
        </div>
        {children}
      </div>
      <div className="ifoot">
        {stopping ? (
          <PrimaryButton data-testid="stop" className="stop" icon="stop" onClick={onStop}>
            Stop
          </PrimaryButton>
        ) : (
          <PrimaryButton
            data-testid="run"
            disabled={runDisabled}
            onClick={onRun}
            title="Run (Ctrl+Enter)"
          >
            {runLabel}
          </PrimaryButton>
        )}
      </div>
    </aside>
  )
}
