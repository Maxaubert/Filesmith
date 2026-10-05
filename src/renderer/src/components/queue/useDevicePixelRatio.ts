import { useEffect, useState } from 'react'

/** window.devicePixelRatio, kept current when the window moves to a monitor
 * with another scale (or the page zoom changes): a resolution media query for
 * the current ratio fires once it stops matching, then re-arms for the new one. */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const update = (): void => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', update)
    // Belt and braces: some moves between monitors only show up as a resize.
    window.addEventListener('resize', update)
    return () => {
      mq.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [dpr])
  return dpr
}
