import { useEffect, useRef, useState, type JSX } from 'react'
import { COMPLETED_TAB, TABS, type TabId } from '@shared/tabs'
import { Icon, type IconName } from './Icon'

const ALL_IDS = TABS.map((c) => c.id)
const byId = (id: TabId): (typeof TABS)[number] => TABS.find((c) => c.id === id) ?? TABS[0]

// The rail's layout is a user preference (order + which verbs are hidden), so it
// lives in localStorage rather than app state: it outlives a session and never
// needs to reach the engine. The keys are tab-specific: a stored CATEGORY order
// from the old rail must not half-apply to verbs.
const ORDER_KEY = 'filesmith.rail.tabOrder'
const HIDDEN_KEY = 'filesmith.rail.tabHidden'

function loadOrder(): TabId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as TabId[]
    const kept = saved.filter((id) => ALL_IDS.includes(id))
    return [...kept, ...ALL_IDS.filter((id) => !kept.includes(id))]
  } catch {
    return ALL_IDS
  }
}
function loadHidden(): Set<TabId> {
  try {
    return new Set((JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as TabId[]) ?? [])
  } catch {
    return new Set()
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/**
 * The verb rail, with an iOS-style edit mode: a pencil reveals a drag grip and a
 * visibility checkmark on each row. The rail names what you want DONE; the file
 * kind is a property of what you dropped, not a place you navigate to.
 *
 * The reorder is a hand-rolled pointer sortable rather than native HTML5 drag,
 * which is janky (no live gap, a ghost image, no control over motion). Here the
 * grabbed row lifts and follows the pointer while the others slide out of its
 * way with a transition, and the new order commits on release. The maths keys
 * off the measured row pitch so it stays correct regardless of spacing.
 */
export function TabRail({
  tab,
  counts,
  completedCount,
  onSelect
}: {
  tab: TabId
  counts: Record<string, number>
  /** Produced files across every workspace. */
  completedCount: number
  onSelect: (c: TabId) => void
}): JSX.Element {
  const [order, setOrder] = useState<TabId[]>(loadOrder)
  const [hidden, setHidden] = useState<Set<TabId>>(loadHidden)
  const [editing, setEditing] = useState(false)

  // Live drag state. `pitch` is the row-to-row distance in px, measured on grab.
  // Mirrored into a ref so the pointerup handler reads the final offset without a
  // stale closure, and so committing the move never happens inside a state
  // updater (which StrictMode double-invokes, applying the move twice).
  type Drag = { index: number; offset: number; pitch: number }
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const rowEls = useRef<(HTMLButtonElement | null)[]>([])
  const startY = useRef(0)

  useEffect(() => localStorage.setItem(ORDER_KEY, JSON.stringify(order)), [order])
  useEffect(() => localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])), [hidden])

  const rows = editing ? order : order.filter((id) => !hidden.has(id))

  function toggleHidden(id: TabId): void {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function stopEditing(): void {
    setEditing(false)
    if (hidden.has(tab)) {
      const firstVisible = order.find((id) => !hidden.has(id))
      if (firstVisible) onSelect(firstVisible)
    }
  }

  // --- pointer sortable ------------------------------------------------------
  function beginDrag(index: number, e: React.PointerEvent): void {
    e.preventDefault()
    startY.current = e.clientY
    // Measure the actual pitch from the first two rows; fall back to one row's
    // height if there's only one.
    const a = rowEls.current[0]?.getBoundingClientRect()
    const b = rowEls.current[1]?.getBoundingClientRect()
    const pitch = a && b ? b.top - a.top : (rowEls.current[index]?.offsetHeight ?? 44) + 4
    const init = { index, offset: 0, pitch }
    dragRef.current = init
    setDrag(init)

    const move = (ev: PointerEvent): void => {
      const next = { index, offset: ev.clientY - startY.current, pitch }
      dragRef.current = next
      setDrag(next)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      const target = clamp(d.index + Math.round(d.offset / d.pitch), 0, order.length - 1)
      if (target === d.index) return
      setOrder((prev) => {
        const nextOrder = [...prev]
        const [moved] = nextOrder.splice(d.index, 1)
        nextOrder.splice(target, 0, moved)
        return nextOrder
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // The slot the grabbed row currently hovers over.
  const target =
    drag == null
      ? null
      : clamp(drag.index + Math.round(drag.offset / drag.pitch), 0, rows.length - 1)

  /** Vertical shift for the row at `i` while a drag is in progress. */
  function shiftFor(i: number): { ty: number; lifted: boolean; animate: boolean } {
    if (drag == null || target == null) return { ty: 0, lifted: false, animate: false }
    if (i === drag.index) return { ty: drag.offset, lifted: true, animate: false }
    // Rows between the source and the target slide one pitch to fill the gap.
    if (drag.index < target && i > drag.index && i <= target)
      return { ty: -drag.pitch, lifted: false, animate: true }
    if (drag.index > target && i < drag.index && i >= target)
      return { ty: drag.pitch, lifted: false, animate: true }
    return { ty: 0, lifted: false, animate: true }
  }

  return (
    <nav className="flex w-[176px] shrink-0 flex-col gap-0.5 border-r border-black/[.06] bg-white/40 px-2 pb-4 lg:w-[212px] lg:px-3">
      <div className="flex items-center justify-between px-1 pb-2 pt-3.5">
        <span className="pl-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
          Do
        </span>
        <button
          onClick={() => (editing ? stopEditing() : setEditing(true))}
          title={editing ? 'Done' : 'Edit'}
          className={`grid h-7 w-7 place-items-center rounded-lg transition ${
            editing ? 'bg-accent text-white' : 'text-dim hover:bg-black/[.05] hover:text-ink'
          }`}
        >
          {editing ? (
            <span className="text-[11px] font-bold uppercase tracking-wide">OK</span>
          ) : (
            <Icon name="edit" className="h-[15px] w-[15px]" strokeWidth={1.9} />
          )}
        </button>
      </div>

      {rows.map((id, i) => {
        const c = byId(id)
        const active = c.id === tab && !editing
        const isHidden = hidden.has(id)
        const n = counts[c.id] ?? 0

        if (editing) {
          const { ty, lifted, animate } = shiftFor(i)
          return (
            <button
              key={c.id}
              ref={(el) => {
                rowEls.current[i] = el
              }}
              onClick={() => toggleHidden(id)}
              style={{
                transform: `translateY(${ty}px)`,
                transition: animate ? 'transform .2s cubic-bezier(.2,0,0,1)' : 'none',
                zIndex: lifted ? 30 : 1,
                touchAction: 'none'
              }}
              className={`relative flex h-11 items-center gap-2.5 rounded-xl px-1.5 text-left text-[13.5px] font-medium ${
                lifted ? 'bg-white shadow-[0_10px_24px_rgba(20,20,45,.16)] scale-[1.02]' : ''
              } ${isHidden ? 'opacity-45' : 'text-[#33333a]'}`}
            >
              {/* Grip: the drag handle. Its own pointer handler starts the drag;
                  stopping click propagation keeps a tap on it from toggling. */}
              <span
                onPointerDown={(e) => beginDrag(i, e)}
                onClick={(e) => e.stopPropagation()}
                className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center text-[#b4b4bd] active:cursor-grabbing"
              >
                <Icon name="grip" className="h-[15px] w-[15px]" strokeWidth={2.2} />
              </span>
              <span
                className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-lg text-white shadow-sm"
                style={{ background: c.color }}
              >
                <Icon name={c.icon as IconName} className="h-[14px] w-[14px]" />
              </span>
              <span className="flex-1">{c.label}</span>
              <span
                className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border ${
                  isHidden ? 'border-black/20 bg-transparent' : 'border-accent bg-accent text-white'
                }`}
              >
                {!isHidden && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
              </span>
            </button>
          )
        }

        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium transition ${
              active
                ? 'bg-accent text-white shadow-[0_6px_16px_rgba(91,91,214,.28)]'
                : 'text-[#33333a] hover:bg-black/[.04]'
            }`}
          >
            <span
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-white shadow-sm"
              style={{ background: active ? 'rgba(255,255,255,.22)' : c.color }}
            >
              <Icon name={c.icon as IconName} className="h-[15px] w-[15px]" />
            </span>
            <span className="flex-1">{c.label}</span>
            {n > 0 && (
              <span
                className={`text-[11.5px] tabular-nums ${active ? 'text-white/75' : 'text-dim'}`}
              >
                {n}
              </span>
            )}
          </button>
        )
      })}
      {/* Pinned to the bottom, below everything the user can reorder: results
          are where you END up, not something you set out to do. */}
      <button
        onClick={() => onSelect('completed')}
        aria-current={tab === 'completed' ? 'true' : undefined}
        className={`mt-auto flex items-center gap-2.5 rounded-[13px] px-2.5 py-2 text-left transition ${
          tab === 'completed' ? 'bg-[#22b364]' : 'hover:bg-black/[.035]'
        }`}
      >
        <span
          className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-lg text-white shadow-sm"
          style={{
            background: tab === 'completed' ? 'rgba(255,255,255,.24)' : COMPLETED_TAB.color
          }}
        >
          <Icon name="check" className="h-[14px] w-[14px]" />
        </span>
        <span
          className={`text-[13.5px] font-semibold tracking-tight ${
            tab === 'completed' ? 'text-white' : ''
          }`}
        >
          Completed
        </span>
        {completedCount > 0 && (
          <span
            className={`ml-auto rounded-md px-1.5 py-px text-[11px] font-bold ${
              tab === 'completed' ? 'bg-white/25 text-white' : 'bg-black/[.055] text-dim'
            }`}
          >
            {completedCount}
          </span>
        )}
      </button>
    </nav>
  )
}
