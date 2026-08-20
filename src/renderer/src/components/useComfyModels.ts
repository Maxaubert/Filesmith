import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComfyStatus } from '@shared/ipc'

export type { ComfyStatus }

/** ComfyUI import status (GPU, engine readiness, remembered folder + models),
 * fetched on mount. `refresh` re-reads it (after install / scan). */
export function useComfyModels(): { status: ComfyStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<ComfyStatus | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const refresh = useCallback(() => {
    void window.filesmith.comfyStatus().then((s) => {
      if (alive.current) setStatus(s)
    })
  }, [])
  useEffect(() => refresh(), [refresh])
  return { status, refresh }
}
