import type { JSX } from 'react'
import { TOOL_CARDS, toolGroups } from '@shared/tabs'
import { Icon } from '../icons/Icon'
import { SettingGroup } from '../ui/Setting'

/** A dense list rather than cards (spec 5.2): no colour swatches, no inspector. */
export function ToolsView({ onPick }: { onPick: (id: string) => void }): JSX.Element {
  return (
    <>
      <div className="vhead">
        <h1>Tools</h1>
        <span>
          {TOOL_CARDS.length} tool{TOOL_CARDS.length === 1 ? '' : 's'}
        </span>
      </div>
      <section className="vbody scroll-thin" aria-label="Tools">
        {toolGroups().map((g) => (
          <SettingGroup key={g.name} title={g.name.toUpperCase()}>
            <ul className="tlist">
              {g.cards.map((c) => (
                <li key={c.id}>
                  <button type="button" className="trow" onClick={() => onPick(c.id)}>
                    <Icon name={c.icon} />
                    <span className="tlab">{c.label}</span>
                    <span className="tdesc">{c.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          </SettingGroup>
        ))}
      </section>
    </>
  )
}
