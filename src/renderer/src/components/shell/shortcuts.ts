import type { KeyLike } from '../queue/tableKeys'

export type Shortcut = 'toggleSidebar' | 'addFiles' | 'run' | 'toggleConsole'

/** Global shortcuts (spec 4.1): Ctrl+B sidebar, Ctrl+O add files, Ctrl+Enter run,
 * Ctrl+` console (by code: the key is a dead key on Nordic layouts). */
export function shortcutFor(e: KeyLike & { code?: string }): Shortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  if (e.code === 'Backquote') return 'toggleConsole'
  const k = e.key.toLowerCase()
  if (k === 'b' && !e.shiftKey) return 'toggleSidebar'
  if (k === 'o' && !e.shiftKey) return 'addFiles'
  if (k === 'enter') return 'run'
  return null
}

/** The parts of a DOM element these checks read. Structural, so the pure
 * helpers typecheck in the node project too (no DOM lib there); any Element fits. */
export interface FocusTarget {
  tagName: string
  closest?: (selector: string) => unknown
  type?: string
  isContentEditable?: boolean
}

/** Typing in the console must not run the app's own shortcuts (Ctrl+Enter). */
export function inConsole(el: FocusTarget | null): boolean {
  return !!el?.closest?.('.console')
}

/** Input types that do not take typed text: view-size keys may still act there. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
])

/** Focus is where the user types (the console prompt, a search box, a textarea):
 * Ctrl+= / Ctrl+- / Ctrl+0 must not change the files view size there (spec 4). */
export function isTextEntryTarget(el: FocusTarget | null): boolean {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((el.type || 'text').toLowerCase())
  return el.isContentEditable === true
}
