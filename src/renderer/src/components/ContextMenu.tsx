import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import { Icon, type IconName } from './Icon'

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
 * horizontally/vertically so it never spills off-screen — so the same call
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
      className="ctx-pop fixed z-50 min-w-[196px] rounded-[13px] border border-black/[.08] bg-white/90 p-[5px] shadow-[0_10px_40px_rgba(20,20,40,.18)] backdrop-blur-xl"
      style={{ left: menu.x, top: menu.y, visibility: 'hidden' }}
    >
      {menu.items.map((item, i) =>
        item.sep ? (
          <div key={i} className="mx-1.5 my-[5px] h-px bg-black/[.07]" />
        ) : (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className={`group flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] transition ${
              item.danger
                ? 'text-[#d1362b] hover:bg-[#d1362b] hover:text-white'
                : 'text-ink hover:bg-accent hover:text-white'
            }`}
          >
            <Icon
              name={item.icon}
              className={`h-4 w-4 shrink-0 transition group-hover:text-white ${
                item.danger ? 'text-[#d1362b]' : 'text-muted'
              }`}
            />
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
