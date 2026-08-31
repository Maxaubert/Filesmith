import type { JSX } from 'react'
import { toolGroups } from '@shared/tabs'
import { Icon, type IconName } from './Icon'

/**
 * The Tools tab's chooser: the long tail of one-off verbs, grouped by what they
 * act on so the section headings do the finding rather than a flat wall of
 * cards. Picking one turns the workspace into an ordinary queue with that tool
 * as its title.
 */
export function ToolsGrid({ onPick }: { onPick: (id: string) => void }): JSX.Element {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-4">
      {toolGroups().map((g) => (
        <section key={g.name} className="mb-7 last:mb-0">
          <h2 className="mb-3 ml-0.5 text-[11px] font-bold uppercase tracking-[0.09em] text-dim">
            {g.name}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-2.5">
            {g.cards.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                className="rounded-2xl border border-black/[.075] bg-white p-[15px] text-left transition hover:-translate-y-px hover:border-accent/40 hover:shadow-[0_6px_16px_rgba(20,20,45,.08)]"
              >
                <span
                  className="mb-2.5 grid h-7 w-7 place-items-center rounded-[9px]"
                  style={{ background: c.color }}
                >
                  <Icon name={c.icon as IconName} className="h-[15px] w-[15px] text-white" />
                </span>
                <div className="text-[13.5px] font-semibold tracking-tight">{c.label}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{c.desc}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
