import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from './icons/Icon'

export type MenuItem =
  | { sep: true }
  | { sep?: false; label: string; icon: IconName; danger?: boolean; onClick: () => void }

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
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const left = menu.x + width > window.innerWidth - pad ? menu.x - width : menu.x
    const top = menu.y + height > window.innerHeight - pad ? menu.y - height : menu.y
    el.style.left = `${Math.max(pad, left)}px`
    el.style.top = `${Math.max(pad, top)}px`
    el.style.visibility = 'visible'
  }, [menu])

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
      className="ctx-pop menu"
      style={{ left: menu.x, top: menu.y, visibility: 'hidden' }}
    >
      {menu.items.map((item, i) =>
        item.sep ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
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
