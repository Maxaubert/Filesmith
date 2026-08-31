import { useEffect, useRef, useState } from 'react'

// Kept apart from OptionsPanel so that file keeps exporting only components
// (React Fast Refresh requires that), matching usePidStatus.

/**
 * Whether WinRAR is installed. Only RAR/CBR *output* depends on it: reading a
 * .cbr always works through bundled 7-Zip. Fetched once on mount, which is
 * enough because installing WinRAR mid-session is not a case worth polling for.
 */
export function useArchiveStatus(): { rar: boolean } {
  const [rar, setRar] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void window.filesmith.archiveStatus().then((s) => {
      if (alive.current) setRar(s.rar)
    })
    return () => {
      alive.current = false
    }
  }, [])
  return { rar }
}
