export type SidebarPref = 'expanded' | 'collapsed'

/** Below this width the sidebar auto-collapses (spec 3.7), without persisting. */
export const NARROW_PX = 1280

export function isCollapsed(pref: SidebarPref, narrow: boolean, override: boolean | null): boolean {
  if (override != null) return override
  return narrow || pref === 'collapsed'
}

/** A toggle on a wide window flips the stored preference; on a narrow window it
 * only overrides for as long as the window stays narrow. */
export function afterToggle(
  pref: SidebarPref,
  narrow: boolean,
  override: boolean | null
): { pref: SidebarPref; override: boolean | null } {
  const now = isCollapsed(pref, narrow, override)
  if (narrow) return { pref, override: !now }
  return { pref: now ? 'expanded' : 'collapsed', override: null }
}
