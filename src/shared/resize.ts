// Resize geometry, shared by the options panel (the live output preview) and the
// tests. Mirrors what ImageMagick actually does, so the number the UI promises
// is the number the file gets.

export type ResizeFit = 'contain' | 'stretch'

export const RESIZE_FITS: { value: ResizeFit; label: string }[] = [
  { value: 'contain', label: 'Keep aspect' },
  { value: 'stretch', label: 'Stretch' }
]

/**
 * The size a WxH request actually produces.
 *
 * The default ('contain') is ImageMagick's `WxH` geometry: fit INSIDE the box,
 * preserving aspect. That means the non-limiting field does nothing at all — for
 * a 4284x5712 portrait, both `5000x400` and `2500x400` yield 300x400, which
 * reads as "resize is broken" unless the result is shown up front. 'stretch' is
 * `WxH!`, which honours both numbers and distorts the image.
 *
 * A blank field scales by the other one. Returns null when there's nothing to do.
 */
export function resizedSize(
  srcW: number,
  srcH: number,
  width: number | null,
  height: number | null,
  fit: ResizeFit
): { w: number; h: number } | null {
  if (srcW <= 0 || srcH <= 0) return null
  const w = width && width > 0 ? width : null
  const h = height && height > 0 ? height : null
  if (!w && !h) return null

  const clamp = (n: number): number => Math.max(1, Math.round(n))
  if (w && h) {
    if (fit === 'stretch') return { w: clamp(w), h: clamp(h) }
    const scale = Math.min(w / srcW, h / srcH)
    return { w: clamp(srcW * scale), h: clamp(srcH * scale) }
  }
  const scale = w ? w / srcW : (h as number) / srcH
  return { w: clamp(srcW * scale), h: clamp(srcH * scale) }
}

/** True when the width or the height the user typed has no effect on the result
 * (the classic "I changed the width and nothing happened" case). */
export function ignoredDimension(
  srcW: number,
  srcH: number,
  width: number | null,
  height: number | null,
  fit: ResizeFit
): 'width' | 'height' | null {
  if (fit === 'stretch' || !width || !height || srcW <= 0 || srcH <= 0) return null
  return width / srcW < height / srcH ? 'height' : 'width'
}
