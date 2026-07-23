import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

// Persist the renderer's session (queues, produced files, options, selected mode)
// to a JSON file in userData so closing and reopening the app keeps your work.
// Written atomically (temp + rename) so a crash mid-write never corrupts it.

function sessionFile(): string {
  return join(app.getPath('userData'), 'session.json')
}

/** The persisted session blob, or null if none / unreadable. */
export function loadSession(): unknown {
  try {
    const p = sessionFile()
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** Write the session blob atomically. Best-effort (never throws to the caller). */
export function saveSession(data: unknown): void {
  try {
    const p = sessionFile()
    mkdirSync(dirname(p), { recursive: true })
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, p)
  } catch {
    /* best effort */
  }
}

/** Which of the given paths still exist on disk (for pruning stale queue items). */
export function filesExist(paths: string[]): boolean[] {
  return paths.map((p) => {
    try {
      return !!p && existsSync(p)
    } catch {
      return false
    }
  })
}
