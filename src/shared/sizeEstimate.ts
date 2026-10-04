// src/shared/sizeEstimate.ts
import type { FileInfo, JobOptions, ToolId } from './types'
import { estimatedPngBytes } from './compress'

// Output-size estimates for the result column and the batch card (spec 6.2).
// Always shown with "~". Conservative by design: a wrong guess is worse than an
// empty cell, so anything unpredictable returns null.

export interface Sample {
  source: number
  output: number
}

export function medianRatio(samples: Sample[]): number | null {
  const r = samples
    .filter((s) => s.source > 0 && s.output >= 0)
    .map((s) => s.output / s.source)
    .sort((a, b) => a - b)
  if (!r.length) return null
  const mid = Math.floor(r.length / 2)
  return r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2
}

type Preset = 'smaller' | 'balanced' | 'best'
const IMAGE_CONVERT: Record<string, Record<Preset, number>> = {
  '.webp': { smaller: 0.15, balanced: 0.22, best: 0.35 },
  '.avif': { smaller: 0.1, balanced: 0.16, best: 0.25 },
  '.jxl': { smaller: 0.15, balanced: 0.22, best: 0.35 },
  '.jpg': { smaller: 0.25, balanced: 0.35, best: 0.5 },
  '.jpeg': { smaller: 0.25, balanced: 0.35, best: 0.5 }
}
const VIDEO_CODEC: Record<string, number> = { h264: 0.5, h265: 0.35, av1: 0.3 }
const PDF_LEVEL: Record<string, number> = { lossless: 0.9, high: 0.7, balanced: 0.5, smallest: 0.3 }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp01 = (n: number): number => Math.max(0.01, Math.min(1, n))

export function ratioFor(tool: ToolId, file: FileInfo, options: JobOptions): number | null {
  if (tool === 'convert') {
    if (file.kind !== 'image') return null
    const row = IMAGE_CONVERT[String(options.format ?? '')]
    if (!row) return null
    const q = String(options.quality ?? 'balanced') as Preset
    return row[q] ?? row.balanced
  }
  if (tool === 'compress') {
    const q = num(options.quality, 80)
    if (file.kind === 'image') {
      const fmt = String(options.imageFormat ?? 'keep')
      if (fmt === 'webp') return clamp01(0.08 + (q / 100) * 0.3)
      if (fmt === 'avif') return clamp01(0.05 + (q / 100) * 0.2)
      return clamp01((q / 100) * 0.6)
    }
    if (file.kind === 'video') {
      const base = VIDEO_CODEC[String(options.videoCodec ?? 'h264')]
      if (base == null) return null
      const s = num(options.scale, 100) / 100
      return clamp01(base * (q / 80) * s * s)
    }
    if (file.kind === 'pdf') return PDF_LEVEL[String(options.pdfLevel ?? 'balanced')] ?? null
    return null // audio: needs the source bitrate, which is not probed
  }
  return null
}

export interface EstimateCtx {
  samples?: Sample[]
  /** Output pixels / source pixels (resize), from the dimension probe. */
  pixelRatio?: number | null
  /** Output pixel count (upscale writes PNG). */
  outPixels?: number | null
}

export function estimateOutputBytes(
  file: FileInfo,
  tool: ToolId,
  options: JobOptions,
  ctx: EstimateCtx = {}
): number | null {
  if (!(file.size > 0)) return null
  const fromBatch = medianRatio(ctx.samples ?? [])
  if (fromBatch != null) return Math.round(file.size * fromBatch)
  if (tool === 'resize')
    return ctx.pixelRatio != null && ctx.pixelRatio > 0
      ? Math.round(file.size * ctx.pixelRatio)
      : null
  if (tool === 'upscale')
    return ctx.outPixels != null && ctx.outPixels > 0
      ? Math.round(estimatedPngBytes(ctx.outPixels, 1))
      : null
  const r = ratioFor(tool, file, options)
  return r == null ? null : Math.round(file.size * r)
}

export function estimateBatch(
  rows: { size: number; estimate: number | null }[]
): { from: number; to: number; files: number } | null {
  let from = 0
  let to = 0
  let files = 0
  for (const r of rows) {
    if (r.estimate == null) continue
    from += r.size
    to += r.estimate
    files += 1
  }
  return files ? { from, to, files } : null
}
