import { useEffect, useRef, useState, type JSX } from 'react'
import type { Operation } from '@shared/catalog'
import { Icon, type IconName } from './Icon'

/**
 * The operation switcher, sitting at the top of the options sidebar. It takes
 * the SELECTED operation's own colour, so the mode is colour-coded and the
 * control doubles as a status light: an orange card means you're compressing, a
 * green one means resizing. Every other control in the panel is themed black, so
 * this coloured card is unmistakably the one primary choice, not a setting.
 */
export function OperationSwitcher({
  operation,
  operations,
  onPick
}: {
  operation: Operation
  operations: Operation[]
  onPick: (id: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-[50px] w-full items-center gap-3 rounded-[13px] px-3 text-left text-white transition"
        style={{
          background: operation.color,
          boxShadow: `0 6px 16px ${operation.color}55`
        }}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-white/[.22]">
          <Icon name={operation.icon as IconName} className="h-[17px] w-[17px]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-.01em]">
          {operation.label}
        </span>
        <Icon
          name="chevron-down"
          className={`h-[18px] w-[18px] shrink-0 text-white/85 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="ctx-pop absolute inset-x-0 top-[calc(100%+6px)] z-20 rounded-[13px] border border-black/[.10] bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.18)]">
          {operations.map((o) => {
            const on = o.id === operation.id
            return (
              <button
                key={o.id}
                onClick={() => {
                  setOpen(false)
                  if (!on) onPick(o.id)
                }}
                className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold transition ${
                  on ? 'bg-black/[.05]' : 'hover:bg-black/[.04]'
                }`}
              >
                <span
                  className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-white"
                  style={{ background: o.color }}
                >
                  <Icon name={o.icon as IconName} className="h-[13px] w-[13px]" />
                </span>
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
