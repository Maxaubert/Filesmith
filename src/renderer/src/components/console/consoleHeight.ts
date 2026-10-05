export const CONSOLE_MIN = 120
export const CONSOLE_DEFAULT = 280
const HEAD = 32

/** The files view keeps at least CONSOLE_MIN px under its 32px head (spec 3). */
export function clampConsoleHeight(h: number, centerH: number): number {
  const max = Math.max(CONSOLE_MIN, centerH - HEAD - CONSOLE_MIN)
  return Math.round(Math.max(CONSOLE_MIN, Math.min(max, h)))
}

export function parseHeight(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= CONSOLE_MIN ? n : CONSOLE_DEFAULT
}
