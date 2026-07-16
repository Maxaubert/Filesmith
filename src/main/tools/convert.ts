import type { ToolTarget } from '@shared/types'

// Pure convert catalog + argument builder (no Electron), so it is unit-testable.
// The runner that spawns ImageMagick lives in registry.ts.
// Image targets ported from RCMM's rcmm-convert.ps1 Get-Category image list.

export interface ConvertTarget extends ToolTarget {
  extra?: string[]
}

export const IMAGE_TARGETS: ConvertTarget[] = [
  { label: 'PNG', ext: '.png' },
  { label: 'JPG', ext: '.jpg' },
  { label: 'WebP', ext: '.webp' },
  { label: 'AVIF', ext: '.avif' },
  { label: 'JXL', ext: '.jxl' },
  { label: 'TIFF', ext: '.tiff' },
  { label: 'BMP', ext: '.bmp' },
  { label: 'GIF', ext: '.gif' },
  { label: 'ICO', ext: '.ico', extra: ['-define', 'icon:auto-resize=256,128,64,48,32,16'] }
]

/** Normalize alias extensions so a .tif source isn't offered "TIFF", etc. */
function normalizeExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === '.tif') return '.tiff'
  if (e === '.jpeg') return '.jpg'
  return e
}

/** Target formats to offer for a source with the given extension (drops same-format). */
export function convertTargets(srcExt: string): ToolTarget[] {
  const src = normalizeExt(srcExt)
  return IMAGE_TARGETS.filter((t) => t.ext !== src).map(({ label, ext }) => ({ label, ext }))
}

export function findTarget(ext: string): ConvertTarget | undefined {
  return IMAGE_TARGETS.find((t) => t.ext === ext.toLowerCase())
}

/** ImageMagick args: `magick <input> [extra...] <output>`. */
export function buildConvertArgs(input: string, output: string, extra: string[] = []): string[] {
  return [input, ...extra, output]
}

/** Map a quality preset ('smaller'|'balanced'|'best') or number to a magick
 * -quality value (1..100), or null to leave the default. */
export function qualityNum(q: unknown): number | null {
  if (typeof q === 'number' && q > 0) return Math.max(1, Math.min(100, Math.round(q)))
  if (q === 'smaller') return 60
  if (q === 'balanced') return 82
  if (q === 'best') return 95
  return null
}
