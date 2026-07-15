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

export function buildResizeArgs(input: string, output: string, spec: string): string[] {
  return [input, '-resize', spec, output]
}
