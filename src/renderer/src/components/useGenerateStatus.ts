import { useCallback, useEffect, useRef, useState } from 'react'
import type { GenModelScan } from '@shared/genArch'

export type GenerateStatus = { available: boolean } & GenModelScan

/** Whether generation is available (a ComfyUI is findable) + the models. */
export function useGenerateStatus(): { status: GenerateStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<GenerateStatus | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const refresh = useCallback(() => {
    void window.filesmith.generateStatus().then((s) => {
      if (alive.current) setStatus(s)
    })
  }, [])
  useEffect(() => refresh(), [refresh])
  return { status, refresh }
}
