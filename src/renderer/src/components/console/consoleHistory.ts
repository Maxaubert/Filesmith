export const HIST_MAX = 100

/** Append a line; a repeat of the newest line is not stored twice. */
export function pushHistory(h: readonly string[], line: string, max = HIST_MAX): string[] {
  if (h[h.length - 1] === line) return [...h]
  return [...h, line].slice(-max)
}

/** idx -1 = editing the draft; otherwise an index into history. */
export interface HistNav {
  idx: number
  draft: string
}
export const HIST_IDLE: HistNav = { idx: -1, draft: '' }

export function histStep(
  h: readonly string[],
  nav: HistNav,
  cur: string,
  dir: -1 | 1
): { nav: HistNav; text: string } | null {
  if (!h.length) return null
  if (nav.idx === -1) {
    if (dir === 1) return null
    return { nav: { idx: h.length - 1, draft: cur }, text: h[h.length - 1] }
  }
  const idx = nav.idx + dir
  if (idx < 0) return { nav, text: h[0] }
  if (idx >= h.length) return { nav: HIST_IDLE, text: nav.draft }
  return { nav: { ...nav, idx }, text: h[idx] }
}
