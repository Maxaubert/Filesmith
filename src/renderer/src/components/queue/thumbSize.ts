import type { ViewSize } from './viewSize'

// Which thumbnail resolution each view size needs on this screen (spec 5).
// Pure, so Vitest covers it; the renderer feeds it window.devicePixelRatio.

/** Thumbnail resolutions the renderer asks main for. 128 is the one every item gets. */
export const THUMB_BUCKETS = [128, 256, 512, 768, 1024] as const
export type ThumbBucket = (typeof THUMB_BUCKETS)[number]
export const BASE_THUMB: ThumbBucket = 128

/** Card width in CSS px per size (Details: the row thumb, Tiles: the tile thumb).
 * Cards use their full --cw: the thumb is a little narrower (8px padding a
 * side), so this errs on the sharp side. */
export const THUMB_CSS_PX: Record<ViewSize, number> = {
  details: 18,
  'details-l': 32,
  tiles: 48,
  medium: 132,
  large: 196,
  xl: 274
}

/** The smallest bucket that covers the size's thumb in device pixels, keeping
 * 128 whenever it already suffices. Capped at the largest bucket. */
export function thumbPxFor(size: ViewSize, dpr: number): ThumbBucket {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const need = Math.ceil(THUMB_CSS_PX[size] * ratio)
  return THUMB_BUCKETS.find((b) => b >= need) ?? THUMB_BUCKETS[THUMB_BUCKETS.length - 1]
}

/** Cache key of a big thumbnail: one per source path and bucket. */
export const thumbKey = (path: string, px: number): string => `${path}@${px}`

/** A thumbnail cache by thumbKey; null marks a request that came back empty. */
export type ThumbCache = Readonly<Record<string, string | null | undefined>>

/** The best cached big thumbnail for a path: the wanted bucket, else the
 * smallest larger one (going back down reuses it), else the largest smaller
 * one above 128. Undefined when none is cached. */
export function bestThumb(cache: ThumbCache, path: string, px: number): string | undefined {
  const have = THUMB_BUCKETS.filter((b) => b > BASE_THUMB && cache[thumbKey(path, b)])
  const pick = have.find((b) => b >= px) ?? have[have.length - 1]
  return pick === undefined ? undefined : (cache[thumbKey(path, pick)] ?? undefined)
}

/** Whether a request for this bucket is still worth making: nothing at or above it is cached. */
export function needsThumb(cache: ThumbCache, path: string, px: number): boolean {
  if (px <= BASE_THUMB) return false
  return !THUMB_BUCKETS.some((b) => b >= px && cache[thumbKey(path, b)])
}
