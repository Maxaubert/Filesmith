import type { JSX } from 'react'
import { COMPLETED_TAB, SETTINGS_TAB, tabById, type Tab, type TabId } from '@shared/tabs'
import { Icon } from '../icons/Icon'

export function Sidebar({
  tab,
  verbs,
  showTools,
  counts,
  completedCount,
  collapsed,
  onToggle,
  onSelect
}: {
  tab: TabId
  verbs: TabId[]
  showTools: boolean
  counts: Record<string, number>
  completedCount: number
  collapsed: boolean
  onToggle: () => void
  onSelect: (t: TabId) => void
}): JSX.Element {
  const item = (t: Tab, n?: number): JSX.Element => (
    <button
      key={t.id}
      type="button"
      className={`item${tab === t.id ? ' on' : ''}`}
      aria-current={tab === t.id ? 'page' : undefined}
      title={t.label}
      onClick={() => onSelect(t.id)}
    >
      <Icon name={t.icon} />
      <span className="lab">{t.label}</span>
      {n ? <span className="n">{n}</span> : null}
    </button>
  )
  return (
    <nav className="side" aria-label="Operations">
      <div className="side-head">
        <span className="lbl">operations</span>
        <button
          type="button"
          className="toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
          onClick={onToggle}
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <div className="nav">
        {verbs.map((id) => item(tabById(id), counts[id]))}
        {showTools && (
          <>
            <div className="nav-sep" role="separator" />
            {item(tabById('tools'), counts.tools)}
          </>
        )}
      </div>
      <div className="spacer" />
      <div className="nav bottom">
        {item(COMPLETED_TAB, completedCount)}
        {item(SETTINGS_TAB)}
      </div>
    </nav>
  )
}
