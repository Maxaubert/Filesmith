import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from '../icons/Icon'
import { nextEnabled, type SelectOption } from './selectNav'

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
  const root = useRef<HTMLDivElement>(null)
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

  function show(): void {
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
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="vs-pop scroll-thin">
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
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => commit(i)}
              >
                <span className="val">
                  {o.label}
                  {o.reason ? `, ${o.reason}` : ''}
                </span>
                {o.value === value && <Icon name="check" />}
              </li>
            )
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
