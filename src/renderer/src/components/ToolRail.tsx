import type { JSX } from 'react'
import type { ToolId } from '@shared/types'
import { TOOLS, ENABLED_TOOLS } from '../lib/tools'
import { Icon } from './Icon'

export function ToolRail({
  tool,
  onSelect
}: {
  tool: ToolId
  onSelect: (t: ToolId) => void
}): JSX.Element {
  return (
    <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-black/[.06] bg-white/40 px-3 pb-4">
      <div className="px-2.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-dim">
        Tools
      </div>
      {TOOLS.map((t) => {
        const enabled = ENABLED_TOOLS.includes(t.id)
        const active = t.id === tool
        return (
          <button
            key={t.id}
            disabled={!enabled}
            onClick={() => enabled && onSelect(t.id)}
            className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition ${
              active
                ? 'bg-accent text-white shadow-[0_6px_16px_rgba(91,91,214,.28)]'
                : 'text-[#33333a] hover:bg-black/[.04]'
            } ${!enabled ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''}`}
          >
            <span
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-white shadow-sm"
              style={{ background: active ? 'rgba(255,255,255,.22)' : t.color }}
            >
              <Icon name={t.icon} className="h-[15px] w-[15px]" />
            </span>
            <span className="flex-1">{t.label}</span>
            {!enabled && (
              <span className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-[10px] font-semibold text-dim">
                soon
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
