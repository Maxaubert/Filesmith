import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComfyModel } from '@shared/comfy'

export interface ComfyStatus {
  nvidia: { name: string; vramMb: number | null } | null
  engineReady: boolean
  /** The shared torch env already exists (setup is then just the spandrel loader). */
  envExists: boolean
  /** The user's ComfyUI has PiD weights we can reuse — PiD is only offered when
   * this is true or PiD is already installed. */
  pidReusable: boolean
  folder: string | null
  models: ComfyModel[]
}

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
