import {
  useEffect,
  useLayoutEffect,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from './icons/Icon'

export type MenuItem =
  | { sep: true }
  | {
      sep?: false
      label: string
      icon: IconName
      danger?: boolean
      /** Shown greyed out, so the menu keeps one shape for every selection. */
      disabled?: boolean
      onClick: () => void
    }

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/**
 * A floating context menu anchored at (x, y). Measures itself, then flips
 * horizontally/vertically so it never spills off-screen, so the same call
 * works for a cursor position (right-click) or a button corner (the ⋯).
 */
export function ContextMenu({
  menu,
  onClose
}: {
  menu: MenuState | null
  onClose: () => void
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  // Measure the rendered menu and nudge it on-screen before paint. Done
  // imperatively (not via state) so opening never costs a second render.
  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return
    const prev = document.activeElement as HTMLElement | null
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const left = menu.x + width > window.innerWidth - pad ? menu.x - width : menu.x
    const top = menu.y + height > window.innerHeight - pad ? menu.y - height : menu.y
    el.style.left = `${Math.max(pad, left)}px`
    el.style.top = `${Math.max(pad, top)}px`
    el.style.visibility = 'visible'
    // Keyboard users land on the first live entry, as in a native menu.
    el.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus()
    // Hand focus back to whatever opened the menu (a table row) on close,
    // unless the user has already moved it somewhere else.
    return () => {
      const a = document.activeElement
      if ((!a || a === document.body || el.contains(a)) && prev?.isConnected) prev.focus()
    }
  }, [menu])

  // Arrow keys walk the enabled entries (disabled buttons are skipped, since
  // they cannot take focus); Home/End jump to the ends.
  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []
    )
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  // Dismiss on any outside interaction.
  useEffect(() => {
    if (!menu) return
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu) return null

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onMenuKey}
      className="ctx-pop menu"
      style={{ left: menu.x, top: menu.y, visibility: 'hidden' }}
    >
      {menu.items.map((item, i) =>
        item.sep ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              item.onClick()
              onClose()
            }}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
