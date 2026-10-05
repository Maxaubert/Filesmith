import type { KeyLike } from './tableKeys'

// Pure model for the files view sizes (spec 1-3), named like Windows File
// Explorer. Kept out of the .tsx files so Vitest and Fast Refresh both work.

export type ViewSize = 'details' | 'tiles' | 'medium' | 'large' | 'xl'
export type ViewIcon = 'view-details' | 'view-tiles' | 'view-medium' | 'view-large' | 'view-xl'

export interface ViewSizeDef {
  id: ViewSize
  label: string
  icon: ViewIcon
  /** Ctrl+Shift+<digit> jumps to this size. */
  digit: number
}

export const VIEW_SIZES: readonly ViewSizeDef[] = [
  { id: 'details', label: 'Details', icon: 'view-details', digit: 1 },
  { id: 'tiles', label: 'Tiles', icon: 'view-tiles', digit: 2 },
  { id: 'medium', label: 'Medium icons', icon: 'view-medium', digit: 3 },
  { id: 'large', label: 'Large icons', icon: 'view-large', digit: 4 },
  { id: 'xl', label: 'Extra large icons', icon: 'view-xl', digit: 5 }
]

export const DEFAULT_VIEW: ViewSize = 'details'
export const VIEW_KEY = 'filesmith.viewSize'

const indexOf = (s: ViewSize): number => VIEW_SIZES.findIndex((d) => d.id === s)

export function viewDef(s: ViewSize): ViewSizeDef {
  return VIEW_SIZES[Math.max(0, indexOf(s))]
}

export function stepSize(s: ViewSize, delta: number): ViewSize {
  const i = Math.max(0, Math.min(VIEW_SIZES.length - 1, indexOf(s) + delta))
  return VIEW_SIZES[i].id
}

export function parseViewSize(v: unknown): ViewSize {
  return VIEW_SIZES.find((d) => d.id === v)?.id ?? DEFAULT_VIEW
}

export type ViewKey = { kind: 'step'; delta: 1 | -1 } | { kind: 'set'; size: ViewSize }
export interface ViewKeyLike extends KeyLike {
  code: string
}

/** Ctrl+= / Ctrl++ bigger, Ctrl+- smaller, Ctrl+0 Details, Ctrl+Shift+1..5 a size.
 * Digits match on `code`, so Shift+1 = `!` on Nordic layouts still works. */
export function viewKeyFor(e: ViewKeyLike): ViewKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  if (e.shiftKey) {
    const m = /^Digit([1-5])$/.exec(e.code)
    if (m) return { kind: 'set', size: VIEW_SIZES[Number(m[1]) - 1].id }
    return e.key === '+' ? { kind: 'step', delta: 1 } : null
  }
  if (e.key === '=' || e.key === '+') return { kind: 'step', delta: 1 }
  if (e.key === '-') return { kind: 'step', delta: -1 }
  if (e.key === '0') return { kind: 'set', size: DEFAULT_VIEW }
  return null
}

export interface WheelState {
  acc: number
  /** Time of the last wheel event. */
  at: number
  /** Time of the last step. */
  last: number
}
export const WHEEL_IDLE: WheelState = { acc: 0, at: -Infinity, last: -Infinity }

const THRESHOLD = 40
const MIN_GAP_MS = 90
const STALE_MS = 250

export function wheelDelta(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 400 : deltaY
}

/** One step per notch; trackpad deltas accumulate. Wheel up (negative) = bigger. */
export function wheelStep(
  s: WheelState,
  delta: number,
  now: number
): { state: WheelState; step: -1 | 0 | 1 } {
  const acc = (now - s.at > STALE_MS ? 0 : s.acc) + delta
  if (Math.abs(acc) >= THRESHOLD && now - s.last > MIN_GAP_MS)
    return { state: { acc: 0, at: now, last: now }, step: acc < 0 ? 1 : -1 }
  return { state: { acc, at: now, last: s.last }, step: 0 }
}

/** Thumbnail pixels a size needs (spec 5): the 128px one covers up to Medium. */
export function thumbPx(s: ViewSize): 128 | 256 {
  return s === 'large' || s === 'xl' ? 256 : 128
}
