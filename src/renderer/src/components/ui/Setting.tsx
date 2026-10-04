import type { JSX, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import { Checkbox } from './Checkbox'

export function SettingGroup({
  title,
  collapsible,
  open = true,
  onToggle,
  children
}: {
  title: string
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <section className="vs-grp">
      <h2 className="vs-gh">
        {collapsible ? (
          <button type="button" className="vs-ghb" aria-expanded={open} onClick={onToggle}>
            <Icon name={open ? 'chev-d' : 'chev-r'} size={12} />
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      {open && children}
    </section>
  )
}

export function Setting({
  title,
  desc,
  warn,
  children
}: {
  title: string
  desc?: ReactNode
  /** Prefix the description with the warning glyph (monochrome warning). */
  warn?: boolean
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="vs-set">
      <div className="vs-t">{title}</div>
      {desc != null && (
        <div className={`vs-d${warn ? ' warn' : ''}`}>
          {warn && <Icon name="warning" size={12} />}
          {desc}
        </div>
      )}
      {children}
    </div>
  )
}

export function CheckSetting({
  checked,
  onChange,
  label,
  sub
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  sub?: string
}): JSX.Element {
  return (
    <div className="vs-chk" onClick={() => onChange(!checked)}>
      <Checkbox
        checked={checked}
        onChange={() => onChange(!checked)}
        label={label}
        size="md"
        focusable
      />
      <span className="lt">
        {label}
        {sub && <span>{sub}</span>}
      </span>
    </div>
  )
}
