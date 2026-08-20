import { useCallback, useEffect, useRef, useState } from 'react'
import type { PidStatus } from '@shared/ipc'

// PiD status hook, kept apart from the PidInstallCard component so the card file
// exports only components (React Fast Refresh requires that).

export type { PidStatus }

/** GPU presence + install state, fetched once on mount. `refresh` re-checks. */
export function usePidStatus(): { status: PidStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<PidStatus | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const refresh = useCallback(() => {
    // Guard against the async GPU probe resolving after the component unmounts.
    void window.filesmith.pidStatus().then((s) => {
      if (alive.current) setStatus(s)
    })
  }, [])
  useEffect(() => refresh(), [refresh])
  return { status, refresh }
}
