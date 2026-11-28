export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** Shown after the label, for example "WinRAR not found" on a disabled
   * target or "needs download" on a selectable Generate model. */
  reason?: string
  /** Option-group heading (Generate's architectures). */
  group?: string
  /** Draw a divider line above this option. */
  sep?: boolean
}

/** Keyboard movement inside the select popup: arrows skip disabled items and
 * stop at the ends, Home/End land on enabled items, a printable key jumps to the
 * next enabled label starting with it. */
export function nextEnabled(
  options: { label: string; disabled?: boolean }[],
  i: number,
  key: string
): number | null {
  const ok = (k: number): boolean => k >= 0 && k < options.length && !options[k].disabled
  if (key === 'ArrowDown') {
    for (let k = i + 1; k < options.length; k++) if (ok(k)) return k
    return i
  }
  if (key === 'ArrowUp') {
    for (let k = i - 1; k >= 0; k--) if (ok(k)) return k
    return i
  }
  if (key === 'Home') {
    for (let k = 0; k < options.length; k++) if (ok(k)) return k
    return null
  }
  if (key === 'End') {
    for (let k = options.length - 1; k >= 0; k--) if (ok(k)) return k
    return null
  }
  if (key.length === 1) {
    const c = key.toLowerCase()
    for (let step = 1; step <= options.length; step++) {
      const k = (i + step) % options.length
      if (ok(k) && options[k].label.toLowerCase().startsWith(c)) return k
    }
    return null
  }
  return null
}

/** The select popup's tallest size (controls.css `.vs-pop`). */
export const POPUP_MAX = 280

/** Where the select popup opens. It drops below the button unless the room
 * below is too small and there is more room above; either way its height is
 * capped to the room on that side (never above POPUP_MAX), so no row is cut
 * off by a scrolling panel or the window edge. */
export function popupPlacement(
  anchor: { top: number; bottom: number },
  boundsTop: number,
  boundsBottom: number,
  wantHeight: number
): { up: boolean; maxHeight: number } {
  const want = Math.min(wantHeight, POPUP_MAX)
  const below = Math.max(0, Math.floor(boundsBottom - anchor.bottom))
  const above = Math.max(0, Math.floor(anchor.top - boundsTop))
  const up = below < want && above > below
  return { up, maxHeight: Math.min(POPUP_MAX, up ? above : below) }
}

/** The scrollTop that brings a row fully into a scrolling list's view, moving
 * as little as possible (like scrollIntoView with block 'nearest', but only
 * the list scrolls, never the panel behind it). */
export function scrollTopFor(
  itemTop: number,
  itemHeight: number,
  scrollTop: number,
  viewHeight: number
): number {
  if (itemTop < scrollTop) return itemTop
  if (itemTop + itemHeight > scrollTop + viewHeight) return itemTop + itemHeight - viewHeight
  return scrollTop
}
