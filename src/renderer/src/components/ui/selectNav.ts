export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** Shown after the label, for example "WinRAR not found" on a disabled
   * target or "needs download" on a selectable Generate model. */
  reason?: string
  /** Option-group heading (Generate's architectures). */
  group?: string
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
