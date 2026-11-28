import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { Icon } from '../icons/Icon'
import { nextEnabled, popupPlacement, scrollTopFor, type SelectOption } from './selectNav'

/** The visible top and bottom of the nearest scrolling ancestor, clipped to
 * the window: the popup must fit inside it. */
function visibleBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) {
      const r = p.getBoundingClientRect()
      top = Math.max(top, r.top)
      bottom = Math.min(bottom, r.bottom)
      break
    }
  }
  return { top, bottom }
}

// A custom listbox (spec 2.7): Chromium draws a native <select> popup in light
// OS chrome, which breaks the dark-only rule.
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  half,
  disabled,
  placeholder = 'choose'
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  label: string
  half?: boolean
  disabled?: boolean
  placeholder?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // Keep the active row in view after opening and keyboard moves, but not
  // after a hover, or the list would jump under the mouse.
  const follow = useRef(false)
  const id = useId()
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', blur)
    }
  }, [open])

  // Flip the popup above the button when it does not fit below.
  useLayoutEffect(() => {
    if (!open) return
    const btn = root.current
    const ul = list.current
    if (!btn || !ul) return
    const r = btn.getBoundingClientRect()
    const b = visibleBounds(btn)
    setPlace(popupPlacement(r, b.top, b.bottom, ul.scrollHeight + 1))
  }, [open])

  useEffect(() => {
    if (!open || !follow.current) return
    const ul = list.current
    const li = document.getElementById(`${id}-${active}`)
    if (!ul || !li) return
    ul.scrollTop = scrollTopFor(li.offsetTop, li.offsetHeight, ul.scrollTop, ul.clientHeight)
  }, [open, active, place, id])

  function show(): void {
    follow.current = true
    setPlace(null)
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      )
    )
    setOpen(true)
  }
  function commit(i: number): void {
    const o = options[i]
    if (!o || o.disabled) return
    onChange(o.value)
    setOpen(false)
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(active)
      return
    }
    const n = nextEnabled(options, active, e.key)
    if (n != null) {
      e.preventDefault()
      follow.current = true
      setActive(n)
    }
  }

  return (
    <div ref={root} className={`vs-selwrap${half ? ' half' : ''}`}>
      <button
        type="button"
        className={`vs-sel${half ? ' half' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="val">
          {current ? current.label : <span className="ph">{placeholder}</span>}
        </span>
        <Icon name="chev-d" />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={`vs-pop scroll-thin${place?.up ? ' up' : ''}`}
          style={place ? { maxHeight: place.maxHeight } : undefined}
        >
          {options.flatMap((o, i) => {
            const head = o.group && o.group !== options[i - 1]?.group ? o.group : null
            const opt = (
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={`${i === active ? 'act' : ''}${o.value === value ? ' cur' : ''}${o.disabled ? ' dis' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (o.disabled) return
                  follow.current = false
                  setActive(i)
                }}
                onClick={() => commit(i)}
              >
                <span className="val">
                  {o.label}
                  {o.reason ? `, ${o.reason}` : ''}
                </span>
                {o.value === value && <Icon name="check" />}
              </li>
            )
            if (o.sep && !head)
              return [<li key={`s-${o.value}`} role="separator" className="vs-pop-sep" />, opt]
            return head
              ? [
                  <li key={`g-${head}`} role="presentation" className="vs-pop-gh">
                    {head.toUpperCase()}
                  </li>,
                  opt
                ]
              : [opt]
          })}
        </ul>
      )}
    </div>
  )
}
