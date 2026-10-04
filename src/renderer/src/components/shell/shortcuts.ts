import type { KeyLike } from '../queue/tableKeys'

export type Shortcut = 'toggleSidebar' | 'addFiles' | 'run'

/** Global shortcuts (spec 4.1): Ctrl+B sidebar, Ctrl+O add files, Ctrl+Enter run. */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'b' && !e.shiftKey) return 'toggleSidebar'
  if (k === 'o' && !e.shiftKey) return 'addFiles'
  if (k === 'enter') return 'run'
  return null
}
