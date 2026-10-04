import type { TabId } from '@shared/tabs'

// Same localStorage keys as the old rail, so a user's order and hidden verbs
// carry over (spec 3.2).
export const ORDER_KEY = 'filesmith.rail.tabOrder'
export const HIDDEN_KEY = 'filesmith.rail.tabHidden'

export function normalizeOrder(saved: unknown, all: TabId[]): TabId[] {
  if (!Array.isArray(saved)) return all
  const kept = saved.filter((id): id is TabId => all.includes(id as TabId))
  return [...kept, ...all.filter((id) => !kept.includes(id))]
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** The verbs shown in the sidebar's top group: ordered, visible, without Tools
 * (Tools has its own slot under the separator). */
export function sidebarVerbs(order: TabId[], hidden: TabId[]): TabId[] {
  return order.filter((id) => id !== 'tools' && !hidden.includes(id))
}
