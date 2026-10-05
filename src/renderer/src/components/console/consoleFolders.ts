const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (i <= 0) return path
  const d = path.slice(0, i)
  return /^[a-z]:$/i.test(d) ? `${d}\\` : d
}

export function pushRecent(list: readonly string[], dir: string, max = 5): string[] {
  return [dir, ...list.filter((d) => !same(d, dir))].slice(0, max)
}

/** Recent console folders, then the queue's folders, five each, no repeats. */
export function folderChoices(
  recent: readonly string[],
  queueDirs: readonly string[],
  max = 5
): string[] {
  const out = recent.slice(0, max)
  let added = 0
  for (const d of queueDirs) {
    if (added >= max) break
    if (out.some((o) => same(o, d))) continue
    out.push(d)
    added += 1
  }
  return out
}
