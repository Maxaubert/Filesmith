import type { KeyLike } from './tableKeys'

// Pure model for the files view sizes (spec 1-3), named like Windows File
// Explorer. Kept out of the .tsx files so Vitest and Fast Refresh both work.

export type ViewSize = 'details' | 'details-l' | 'tiles' | 'medium' | 'large' | 'xl'
export interface ViewSizeDef {
  id: ViewSize
  label: string
}

/** All six, in wheel order: Ctrl+wheel and Ctrl+= / Ctrl+- step through these. */
export const VIEW_SIZES: readonly ViewSizeDef[] = [
  { id: 'details', label: 'Details' },
  { id: 'details-l', label: 'Large details' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'medium', label: 'Medium icons' },
  { id: 'large', label: 'Large icons' },
  { id: 'xl', label: 'Extra large icons' }
]

/** The View menu offers only these three; the others are reached by Ctrl+wheel. */
export const MENU_SIZES: readonly ViewSize[] = ['details', 'tiles', 'xl']

/** The two table sizes: head, columns, column-aligned totals. */
export function isListSize(s: ViewSize): boolean {
  return s === 'details' || s === 'details-l'
}

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

/** Ctrl+= / Ctrl++ (also Ctrl+Shift+=) bigger, Ctrl+- smaller, Ctrl+0 Details.
 * There are no per-size shortcuts: the menu and Ctrl+wheel pick a size. */
export function viewKeyFor(e: KeyLike): ViewKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  // Shifted, only + counts (Ctrl+Shift+= on US); Nordic Shift+0 makes '=', not a zoom key.
  if (e.shiftKey) return e.key === '+' ? { kind: 'step', delta: 1 } : null
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
