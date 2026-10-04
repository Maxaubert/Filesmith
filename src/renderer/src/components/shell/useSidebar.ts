import { useCallback, useEffect, useState } from 'react'
import { afterToggle, isCollapsed, NARROW_PX, type SidebarPref } from './sidebarState'

const KEY = 'filesmith.sidebar'

function readPref(): SidebarPref {
  try {
    return localStorage.getItem(KEY) === 'collapsed' ? 'collapsed' : 'expanded'
  } catch {
    return 'expanded'
  }
}

export function useSidebar(): { collapsed: boolean; toggle: () => void } {
  const [pref, setPref] = useState<SidebarPref>(readPref)
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_PX)
  // An override only applies to the width class it was made in, so crossing
  // the breakpoint restores the stored preference without an effect.
  const [override, setOverride] = useState<{ narrow: boolean; value: boolean } | null>(null)

  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth < NARROW_PX)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const ov = override && override.narrow === narrow ? override.value : null
  const toggle = useCallback(() => {
    const next = afterToggle(pref, narrow, ov)
    if (next.pref !== pref) {
      setPref(next.pref)
      try {
        localStorage.setItem(KEY, next.pref)
      } catch {
        /* storage blocked: the toggle still works for this session */
      }
    }
    setOverride(next.override == null ? null : { narrow, value: next.override })
  }, [pref, narrow, ov])

  return { collapsed: isCollapsed(pref, narrow, ov), toggle }
}
