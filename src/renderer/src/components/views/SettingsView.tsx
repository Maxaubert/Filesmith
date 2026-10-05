import { useRef, useState, type JSX, type PointerEvent } from 'react'
import { tabById, type TabId } from '@shared/tabs'
import { Icon } from '../icons/Icon'
import { moveItem } from '../shell/railPrefs'
import { Checkbox } from '../ui/Checkbox'
import { SettingGroup } from '../ui/Setting'
import { ClaudeSkill } from './ClaudeSkill'
import { ToolStatus } from './ToolStatus'

type Rail = {
  order: TabId[]
  hidden: TabId[]
  setOrder: (o: TabId[]) => void
  toggleHidden: (id: TabId) => void
}

const PITCH = 36

/** Sidebar order and visibility (moved from the old rail edit mode, spec 3.2 /
 * 5.4) and tool status. Same pointer sortable as before, plus Alt+Up/Down. */
export function SettingsView({ rail }: { rail: Rail }): JSX.Element {
  const [drag, setDrag] = useState<{ index: number; offset: number } | null>(null)
  const dragRef = useRef<{ index: number; offset: number } | null>(null)

  function begin(index: number, e: PointerEvent): void {
    e.preventDefault()
    const startY = e.clientY
    const set = (d: { index: number; offset: number } | null): void => {
      dragRef.current = d
      setDrag(d)
    }
    set({ index, offset: 0 })
    const move = (ev: globalThis.PointerEvent): void => set({ index, offset: ev.clientY - startY })
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      set(null)
      if (!d) return
      const target = Math.max(
        0,
        Math.min(rail.order.length - 1, d.index + Math.round(d.offset / PITCH))
      )
      if (target !== d.index) rail.setOrder(moveItem(rail.order, d.index, target))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const target = drag
    ? Math.max(0, Math.min(rail.order.length - 1, drag.index + Math.round(drag.offset / PITCH)))
    : null
  function shift(i: number): number {
    if (!drag || target == null) return 0
    if (i === drag.index) return drag.offset
    if (drag.index < target && i > drag.index && i <= target) return -PITCH
    if (drag.index > target && i < drag.index && i >= target) return PITCH
    return 0
  }

  return (
    <>
      <div className="vhead">
        <h1>Settings</h1>
        <span>sidebar and tools</span>
      </div>
      <section className="vbody scroll-thin vs" aria-label="Settings">
        <SettingGroup title="SIDEBAR">
          <ul className="sortlist" aria-label="Sidebar order">
            {rail.order.map((id, i) => {
              const t = tabById(id)
              const shown = !rail.hidden.includes(id)
              return (
                <li
                  key={id}
                  className={`sortrow${drag?.index === i ? ' lifted' : ''}`}
                  style={{
                    transform: `translateY(${shift(i)}px)`,
                    transition: drag && drag.index !== i ? 'transform .15s' : undefined
                  }}
                  tabIndex={0}
                  aria-label={`${t.label}, position ${i + 1}. Alt+Up or Alt+Down to move`}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                    e.preventDefault()
                    const to = e.key === 'ArrowUp' ? i - 1 : i + 1
                    if (to >= 0 && to < rail.order.length)
                      rail.setOrder(moveItem(rail.order, i, to))
                  }}
                >
                  <span className="grip" onPointerDown={(e) => begin(i, e)} aria-hidden="true">
                    <Icon name="grip" />
                  </span>
                  <Icon name={t.icon} />
                  <span className="slab">{t.label}</span>
                  <Checkbox
                    checked={shown}
                    onChange={() => rail.toggleHidden(id)}
                    label={`Show ${t.label} in the sidebar`}
                    size="md"
                    focusable
                  />
                </li>
              )
            })}
          </ul>
        </SettingGroup>
        <SettingGroup title="TOOLS">
          <ToolStatus />
        </SettingGroup>
        <SettingGroup title="CLAUDE">
          <ClaudeSkill />
        </SettingGroup>
      </section>
    </>
  )
}
