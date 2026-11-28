// The redesign's table needs about 1440px to give the name column room
// (spec section 3.7). Clamp to the display so a small laptop still fits.

export const DEFAULT_WINDOW = { width: 1440, height: 900 }
export const MIN_WINDOW = { width: 1100, height: 640 }

export function initialWindowSize(work: { width: number; height: number }): {
  width: number
  height: number
} {
  return {
    width: Math.min(DEFAULT_WINDOW.width, work.width),
    height: Math.min(DEFAULT_WINDOW.height, work.height)
  }
}

/** Start size and minimum size for a work area. On a display smaller than
 * MIN_WINDOW the minimum shrinks too, so the window never starts larger than
 * the screen and can still be resized to fit it. */
export function windowBounds(work: { width: number; height: number }): {
  width: number
  height: number
  minWidth: number
  minHeight: number
} {
  return {
    ...initialWindowSize(work),
    minWidth: Math.min(MIN_WINDOW.width, work.width),
    minHeight: Math.min(MIN_WINDOW.height, work.height)
  }
}
