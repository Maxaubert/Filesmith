// Folders the user picked for output, newest first. A per-viewer convenience,
// so localStorage; it can be empty or throw (private window), never required.

export const RECENT_KEY = 'filesmith.output.recent'
export const RECENT_MAX = 5

export function loadRecentFolders(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function pushRecent(list: string[], path: string): string[] {
  return [path, ...list.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, RECENT_MAX)
}

export function addRecentFolder(path: string): string[] {
  const next = pushRecent(loadRecentFolders(), path)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* not stored; the dropdown still works */
  }
  return next
}
