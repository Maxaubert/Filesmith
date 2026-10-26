// The Rename pattern, shared by the engine and the options panel's live example.
// Tokens: {name} the source's name without extension, {n} 1-based position in
// the run, {date} today as YYYY-MM-DD.

export const RENAME_TOKENS = ['{name}', '{n}', '{date}'] as const

const pad = (n: number): string => String(n).padStart(2, '0')

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A safe file name (no extension) from the pattern. Characters Windows forbids
 * become `_`; an empty or dots-only result falls back to the source name. */
export function renderOutputName(pattern: string, name: string, seq: number, now: Date): string {
  const raw = pattern
    .replace(/\{name\}/gi, name)
    .replace(/\{n\}/gi, String(seq))
    .replace(/\{date\}/gi, isoDate(now))
  const safe = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return safe && !/^\.+$/.test(safe) ? safe : name
}
