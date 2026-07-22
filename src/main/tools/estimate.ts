// Estimated progress for tools whose CLI reports no real progress (ImageMagick,
// mutool, ghostscript, caesium, the PiD diffusion loop). These finish a single
// opaque call, so a MEASURED percentage isn't available — instead we ease the bar
// toward a soft ceiling on a decay curve sized to an expected duration, so it
// always moves, and the caller snaps to done when the op actually finishes. This
// is an honest estimate, not a measurement; anything the tool DOES instrument
// (ffmpeg, Real-ESRGAN, PDF split) uses its real percentage instead.

export interface EstimateTicker {
  stop(): void
}

/**
 * Start an estimated-progress ticker. Calls `onPct` every ~200ms with a value
 * that eases from 0 toward `ceiling` (default 95, never reached) — reaching ~95%
 * of the ceiling at `expectedSec`, then creeping the rest. `startPct` lets a
 * restart continue from where a previous ticker left off instead of snapping back.
 */
export function estimateProgress(
  expectedSec: number,
  onPct: (pct: number) => void,
  opts: { ceiling?: number; startPct?: number } = {}
): EstimateTicker {
  const ceiling = opts.ceiling ?? 95
  const startPct = Math.max(0, Math.min(ceiling, opts.startPct ?? 0))
  const intervalMs = 200
  // tau chosen so t = expectedSec reaches ~95% of the remaining headroom.
  const tau = Math.max(0.2, expectedSec) / 3
  let elapsed = 0
  const tick = (): void => {
    elapsed += intervalMs / 1000
    const pct = startPct + (ceiling - startPct) * (1 - Math.exp(-elapsed / tau))
    onPct(Math.min(ceiling, pct))
  }
  tick() // emit an initial value immediately so the bar goes determinate at once
  let timer: ReturnType<typeof setInterval> | null = setInterval(tick, intervalMs)
  // Never let a stray ticker hold the process open.
  timer?.unref?.()
  return {
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}

/**
 * A rough expected duration (seconds) for a size-bound op, from the input bytes.
 * Deliberately generous and clamped — the curve only needs a plausible pace, not
 * a real prediction.
 */
export function estimateSecForBytes(bytes: number, perMB = 0.06, base = 0.6): number {
  return Math.max(0.5, Math.min(90, base + (bytes / 1_000_000) * perMB))
}
