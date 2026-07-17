import type { JobOptions } from '@shared/types'

// Pure resize spec + argument builder (ImageMagick -resize). No Electron.

/**
 * Build the ImageMagick geometry spec from options:
 * - percent mode: `"50%"`
 * - dimensions mode: `"800x600"` (aspect-preserving) or `"800x600!"` when `exact`.
 */
export function buildResizeSpec(options: JobOptions): string {
  const mode = String(options.mode ?? 'percent')
  if (mode === 'percent') {
    const pct = Number(options.percent ?? 50)
    return `${pct}%`
  }
  const w = options.width != null && options.width !== '' ? String(options.width) : ''
  const h = options.height != null && options.height !== '' ? String(options.height) : ''
  return `${w}x${h}${options.exact ? '!' : ''}`
}

/**
 * True when a resize spec is actually usable. Guards the empty/zero cases the UI
 * can produce: dimensions mode with both fields blank (`"x"`/`"x!"`) and percent
 * mode with a blank/zero/non-finite value (`"0%"`, `"NaN%"`).
 */
export function isValidResizeSpec(spec: string): boolean {
  if (/^x!?$/.test(spec)) return false
  if (spec.endsWith('%')) {
    const n = Number(spec.slice(0, -1))
    return Number.isFinite(n) && n > 0
  }
  return true
}

/**
 * ImageMagick resize args. Animated GIFs must be `-coalesce`d before `-resize`
 * (each frame is a partial delta; resizing the deltas directly smears/misaligns
 * them); `-layers optimize` re-packs the result back into a small animation.
 */
export function buildResizeArgs(
  input: string,
  output: string,
  spec: string,
  animated = false
): string[] {
  if (animated) return [input, '-coalesce', '-resize', spec, '-layers', 'optimize', output]
  return [input, '-resize', spec, output]
}
