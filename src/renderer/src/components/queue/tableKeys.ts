export type TableKey =
  'up' | 'down' | 'extendUp' | 'extendDown' | 'toggle' | 'selectAll' | 'remove' | 'open' | 'menu'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Keyboard map for the files table (spec 4.1). Ctrl+Enter is left for Run. */
export function tableKey(e: KeyLike): TableKey | null {
  if (e.altKey) return null
  const mod = e.ctrlKey || e.metaKey
  if (mod) return e.key.toLowerCase() === 'a' && !e.shiftKey ? 'selectAll' : null
  if (e.key === 'ArrowUp') return e.shiftKey ? 'extendUp' : 'up'
  if (e.key === 'ArrowDown') return e.shiftKey ? 'extendDown' : 'down'
  if (e.key === ' ') return 'toggle'
  if (e.key === 'Delete') return 'remove'
  if (e.key === 'Enter') return 'open'
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return 'menu'
  return null
}
