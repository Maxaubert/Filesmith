import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_VIEW, parseViewSize, stepSize, VIEW_KEY, type ViewSize } from './viewSize'

function read(): ViewSize {
  try {
    return parseViewSize(localStorage.getItem(VIEW_KEY))
  } catch {
    return DEFAULT_VIEW
  }
}

/** The files view size, one per app (spec 3), persisted like the sidebar. */
export function useViewSize(): {
  size: ViewSize
  flash: boolean
  setSize: (s: ViewSize, opts?: { flash?: boolean }) => boolean
  step: (delta: number) => boolean
} {
  const [size, setState] = useState<ViewSize>(read)
  const [flash, setFlash] = useState(false)
  // Mirrors `size` for the stable callbacks; written only inside them.
  const cur = useRef<ViewSize>(size)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const setSize = useCallback((next: ViewSize, opts: { flash?: boolean } = {}): boolean => {
    if (next === cur.current) return false
    cur.current = next
    setState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* storage blocked: the size still applies for this session */
    }
    if (opts.flash) {
      setFlash(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setFlash(false), 450)
    }
    return true
  }, [])

  const step = useCallback(
    (delta: number): boolean => setSize(stepSize(cur.current, delta), { flash: true }),
    [setSize]
  )

  return { size, flash, setSize, step }
}
