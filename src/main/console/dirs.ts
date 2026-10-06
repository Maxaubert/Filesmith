import { readdirSync, statSync } from 'fs'
import { win32 } from 'path'
import type { ConsoleEntry } from '@shared/console'

/** `cd <arg>` from `base` (spec 5). Pure path math; existence is checked apart. */
export function resolveCd(base: string, arg: string, home: string): string {
  if (arg === '~') return home
  if (arg.startsWith('~\\') || arg.startsWith('~/')) return win32.resolve(home, arg.slice(2))
  if (/^[a-z]:$/i.test(arg)) return `${arg.toUpperCase()}\\`
  return win32.resolve(base, arg)
}

export function isDir(p: string): boolean {
  try {
    return win32.isAbsolute(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Entries of `dir` starting with `name` (case-insensitive), for completion. */
export function listEntries(dir: string, name: string, max = 200): ConsoleEntry[] {
  try {
    const n = name.toLowerCase()
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.name.toLowerCase().startsWith(n))
      .slice(0, max)
      .map((d) => {
        const isFolder = d.isDirectory()
        let size = 0
        if (!isFolder)
          try {
            size = statSync(win32.join(dir, d.name)).size
          } catch {
            /* unreadable: size 0 */
          }
        return { name: d.name, dir: isFolder, size }
      })
  } catch {
    return []
  }
}
