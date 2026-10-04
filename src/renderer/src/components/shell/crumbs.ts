import { tabById, type TabId, type ToolCard } from '@shared/tabs'
import { groupLabel } from '../queueGroups'

export type CrumbAction = 'tools' | 'clearSelection'
export interface Crumb {
  label: string
  action?: CrumbAction
  ariaLabel?: string
}

/** Title-bar breadcrumb per context (spec 3.1). */
export function crumbsFor(tab: TabId, card: ToolCard | null, group: string | null): Crumb[] {
  if (tab === 'tools')
    return card
      ? [
          { label: 'pdf tools', action: 'tools', ariaLabel: 'Back to Tools' },
          { label: card.label.toLowerCase() }
        ]
      : [{ label: 'pdf tools' }]
  const label = tabById(tab).label.toLowerCase()
  if (tab === 'generate' || tab === 'completed' || tab === 'settings' || !group) return [{ label }]
  return [{ label, action: 'clearSelection' }, { label: groupLabel(group).toLowerCase() }]
}
