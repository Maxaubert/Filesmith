// The redesign's table needs about 1440px to give the name column room
// (spec section 3.7). Clamp to the display so a small laptop still fits.

export const DEFAULT_WINDOW = { width: 1440, height: 900 }
export const MIN_WINDOW = { width: 1100, height: 640 }

export function initialWindowSize(work: { width: number; height: number }): {
  width: number
  height: number
} {
  return {
    width: Math.max(MIN_WINDOW.width, Math.min(DEFAULT_WINDOW.width, work.width)),
    height: Math.max(MIN_WINDOW.height, Math.min(DEFAULT_WINDOW.height, work.height))
  }
}
