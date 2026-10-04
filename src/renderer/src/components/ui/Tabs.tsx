import { useRef, type JSX } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../icons/Icon'
import { rovingIndex } from './roving'

export interface TabDef<T extends string> {
  id: T
  label: string
  icon: IconName
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix
}: {
  tabs: TabDef<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  idPrefix: string
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className={`tab${t.id === value ? ' on' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const n = rovingIndex(e.key, i, tabs.length)
            if (n == null) return
            e.preventDefault()
            onChange(tabs[n].id)
            refs.current[n]?.focus()
          }}
        >
          <Icon name={t.icon} />
          <span className="tl" data-t={t.label}>
            {t.label}
          </span>
        </button>
      ))}
    </div>
  )
}
