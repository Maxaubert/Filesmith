import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from '../icons/Icon'
import { MENU_SIZES, viewDef, type ViewSize } from './viewSize'

/** The files toolbar's View button and its menu (spec 2). The menu offers three
 * sizes as plain text; the other three are reached with Ctrl+wheel, and the
 * button always names the current size, whichever it is. */
export function ViewMenu({
  size,
  flash,
  onPick
}: {
  size: ViewSize
  flash: boolean
  onPick: (s: ViewSize) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const def = viewDef(size)

  // Anchor under the button, right-aligned, before paint; focus the checked entry.
  useLayoutEffect(() => {
    const el = pop.current
    const b = btn.current
    if (!open || !el || !b) return
    const r = b.getBoundingClientRect()
    el.style.top = `${r.bottom}px`
    el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`
    el.style.visibility = 'visible'
    // After Ctrl+wheel the size may be one the menu does not list: focus the first entry.
    const first =
      el.querySelector<HTMLElement>('[aria-checked="true"]') ??
      el.querySelector<HTMLElement>('.menu-item')
    first?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event): void => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    const away = (): void => setOpen(false)
    window.addEventListener('mousedown', outside)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
    }
  }, [open])

  function pick(s: ViewSize): void {
    onPick(s)
    setOpen(false)
    btn.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btn.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = Array.from(pop.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const n =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length
    items[n].focus()
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`viewbtn${flash ? ' flash' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${def.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="vl">{def.label}</span>
        <Icon name="chev-d" size={12} className="k" />
      </button>
      <span className="sr-only" aria-live="polite">
        {`View: ${def.label}`}
      </span>
      {open && (
        <div
          ref={pop}
          role="menu"
          aria-label="View"
          className="menu viewmenu"
          style={{ visibility: 'hidden' }}
          onKeyDown={onKey}
          onContextMenu={(e) => e.preventDefault()}
        >
          {MENU_SIZES.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === size}
              className="menu-item"
              onClick={() => pick(id)}
            >
              <Icon name="check" size={12} className="tick" />
              <span className="ml">{viewDef(id).label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
