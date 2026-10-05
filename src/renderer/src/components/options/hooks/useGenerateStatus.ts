import { useCallback, useEffect, useState } from 'react'
import type { GenModelScan } from '@shared/genArch'

export type GenerateStatus = { available: boolean } & GenModelScan

// One shared answer: the inspector refreshes it after a folder pick, and the
// Run button (App) must see that same refresh to stop saying "no model".
let latest: GenerateStatus | null = null
const listeners = new Set<(s: GenerateStatus) => void>()

function fetchStatus(): void {
  void window.filesmith.generateStatus().then((s) => {
    latest = s
    for (const l of listeners) l(s)
  })
}

/** Whether generation is available (a ComfyUI is findable) + the models. */
export function useGenerateStatus(): { status: GenerateStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<GenerateStatus | null>(latest)
  useEffect(() => {
    listeners.add(setStatus)
    fetchStatus()
    return () => {
      listeners.delete(setStatus)
    }
  }, [])
  const refresh = useCallback(() => fetchStatus(), [])
  return { status, refresh }
}
